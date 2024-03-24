import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "../apps/llmail.js";
import * as llmynx from "../apps/llmynx.js";
import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import * as dreamMaker from "../llm/dreamMaker.js";
import { ContentSource, LlmRole } from "../llm/llmDtos.js";
import * as llmService from "../llm/llmService.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as logService from "../utils/logService.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import * as commandHandler from "./commandHandler.js";
import { NextCommandAction } from "./commandHandler.js";
import * as promptBuilder from "./promptBuilder.js";

const maxErrorCount = 5;

export async function run() {
  // Show Agent Config exept the agent prompt
  await output.commentAndLog(
    `Agent configured to use ${config.agent.shellModel} model`,
  );

  // Show System Message
  await output.commentAndLog("System Message:");
  const systemMessage = contextManager.getSystemMessage();
  output.write(systemMessage);
  await logService.write({
    role: LlmRole.System,
    content: systemMessage,
    type: "system",
  });

  let nextCommandAction = NextCommandAction.Continue;

  let llmErrorCount = 0;
  let nextPromptIndex = 0;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    await output.commentAndLog("Starting Context:");

    const latestDream = await dreamMaker.goodmorning();
    if (latestDream) {
      await contextManager.append("Previous Session Notes:");
      await contextManager.append(latestDream);
    }

    for (const initialCommand of config.agent.initialCommands) {
      let prompt = await promptBuilder.getPrompt(0, false);
      prompt = `${++nextPromptIndex}. ${prompt}`;
      await contextManager.append(
        prompt,
        ContentSource.ConsolePrompt,
        nextPromptIndex,
      );
      await commandHandler.processCommand(
        prompt,
        config.resolveConfigVars(initialCommand),
      );
    }

    inputMode.toggle(InputMode.Debug);

    let pauseSeconds = config.agent.debugPauseSeconds;
    let wakeOnMessage = config.agent.wakeOnMessage;

    while (nextCommandAction == NextCommandAction.Continue) {
      let prompt = await promptBuilder.getPrompt(pauseSeconds, wakeOnMessage);
      let consoleInput = "";

      // Debug command prompt
      if (inputMode.current === InputMode.Debug) {
        consoleInput = await promptBuilder.getInput(
          `${prompt}`,
          pauseSeconds,
          wakeOnMessage,
        );
      }
      // LLM command prompt
      else if (inputMode.current === InputMode.LLM) {
        prompt = `${++nextPromptIndex}. ${prompt}`;

        const workingMsg =
          prompt +
          chalk[output.OutputColor.loading](
            `LLM (${config.agent.shellModel}) Working...`,
          );

        try {
          await checkNewMailNotification();
          await checkContextLimitWarning();

          await contextManager.append(
            prompt,
            ContentSource.ConsolePrompt,
            nextPromptIndex,
          );

          process.stdout.write(workingMsg);

          consoleInput = await llmService.query(
            config.agent.shellModel,
            contextManager.getSystemMessage(),
            contextManager.getCombinedMessages(),
            "console",
          );

          clearPromptMessage(workingMsg);
        } catch (e) {
          // Can't do this in a finally because it needs to happen before the error is printed
          clearPromptMessage(workingMsg);

          ({ llmErrorCount, pauseSeconds, wakeOnMessage } =
            await handleErrorAndSwitchToDebugMode(e, llmErrorCount, false));

          continue;
        }
      } else {
        throw `Invalid input mode: ${inputMode.current}`;
      }

      // Run the command
      try {
        ({ nextCommandAction, pauseSeconds, wakeOnMessage } =
          await commandHandler.processCommand(prompt, consoleInput));

        if (inputMode.current == InputMode.LLM) {
          llmErrorCount = 0;
        }
      } catch (e) {
        ({ llmErrorCount, pauseSeconds, wakeOnMessage } =
          await handleErrorAndSwitchToDebugMode(e, llmErrorCount, true));
        continue;
      }

      // If the user is in debug mode and they didn't enter anything, switch to LLM
      // If in LLM mode, auto switch back to debug
      if (
        (inputMode.current == InputMode.Debug && !consoleInput) ||
        inputMode.current == InputMode.LLM
      ) {
        inputMode.toggle();
      }
    }

    if (nextCommandAction == NextCommandAction.EndSession) {
      llmynx.clear();
      contextManager.clear();
      nextCommandAction = NextCommandAction.Continue;
      nextPromptIndex = 0;
    }
  }
}

function clearPromptMessage(waitingMessage: string) {
  readline.moveCursor(process.stdout, -waitingMessage.length, 0);
  process.stdout.write(" ".repeat(waitingMessage.length));
  readline.moveCursor(process.stdout, -waitingMessage.length, 0);
}

/** Name is comically long because of a prettier formatting issue when the name is too short */
async function handleErrorAndSwitchToDebugMode(
  e: unknown,
  llmErrorCount: number,
  addToContext: boolean,
) {
  const maxErrorLength = 200;
  const errorMsg = `${e}`;

  if (addToContext) {
    await contextManager.append(errorMsg.slice(0, maxErrorLength));

    if (errorMsg.length > maxErrorLength) {
      await contextManager.append("...");
      await output.errorAndLog(
        `Error too long for context: ${errorMsg.slice(200)}`,
      );
    }
  } else {
    await output.errorAndLog(errorMsg);
  }

  // If llm is in some error loop then hold in debug mode
  let pauseSeconds = config.agent.debugPauseSeconds;
  let wakeOnMessage = config.agent.wakeOnMessage;

  if (inputMode.current == InputMode.LLM) {
    llmErrorCount++;

    if (llmErrorCount >= maxErrorCount) {
      pauseSeconds = 0;
      wakeOnMessage = false;

      if (llmErrorCount == maxErrorCount) {
        await output.errorAndLog(`Too many LLM errors. Holding in debug mode.`);
      }
    }
  }

  inputMode.toggle(InputMode.Debug);

  return {
    llmErrorCount,
    pauseSeconds,
    wakeOnMessage,
  };
}

let mailBlackoutCountdown = 0;

async function checkNewMailNotification() {
  let supressMail = false;
  if (mailBlackoutCountdown > 0) {
    mailBlackoutCountdown--;
    supressMail = true;
  }

  // Check for unread threads
  const unreadThreads = await llmail.getUnreadThreads();
  if (!unreadThreads.length) {
    return;
  }

  if (supressMail) {
    await output.commentAndLog(
      `New mail notifications blackout in effect. ${mailBlackoutCountdown} cycles remaining.`,
    );
    return;
  }

  // Get the new messages for each thread
  const newMessages: string[] = [];
  for (const { threadId, newMsgId } of unreadThreads) {
    newMessages.push(await llmail.readThread(threadId, newMsgId, true));
  }

  // Check that token max for session will not be exceeded
  const newMsgTokenCount = newMessages.reduce(
    (acc, msg) => acc + utilities.getTokenCount(msg),
    0,
  );

  const sessionTokens = contextManager.getTokenCount();
  const tokenMax = config.agent.tokenMax;

  // Show full messages unless we are close to the token limit of the session
  // or in simple mode, which means non-threaded messages
  if (sessionTokens + newMsgTokenCount < tokenMax * 0.75) {
    for (const newMessage of newMessages) {
      await contextManager.append("New Message:", ContentSource.Console);
      await contextManager.append(newMessage, ContentSource.Console);
    }

    for (const unreadThread of unreadThreads) {
      await llmail.markAsRead(unreadThread.threadId);
    }

    mailBlackoutCountdown = config.mailBlackoutCycles;
  } else if (llmail.simpleMode) {
    await contextManager.append(
      `You have new mail, but not enough context to read them.\n` +
        `After you 'endsession' and the context resets, you will be able to read them.`,
      ContentSource.Console,
    );
  }
  // LLM will in many cases end the session here, when the new session starts
  // this code will run again, and show a full preview of the messages
  else {
    const threadIds = unreadThreads.map((t) => t.threadId).join(", ");

    await contextManager.append(
      `New Messages on Thread ID ${threadIds}\n` +
        `Use llmail read <id>' to read the thread, but be mindful you are close to the token limit for the session.`,
      ContentSource.Console,
    );
  }
}

async function checkContextLimitWarning() {
  const tokenCount = contextManager.getTokenCount();
  const tokenMax = config.agent.tokenMax;

  if (tokenCount > tokenMax) {
    await contextManager.append(
      `The token limit for this session has been exceeded.
Use \`endsession <note>\` to clear the console and reset the session.
  The note should help you find your bearings in the next session. 
  The note should contain your next goal, and important things should you remember.
  Try to keep the note around 400 tokens.`,
      ContentSource.Console,
    );
  }
}
