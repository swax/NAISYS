// A bad play on words, but this is like lynx but for LLMs

import { exec } from "child_process";
import yaml from "js-yaml";
import OpenAI from "openai";
import { get_encoding } from "tiktoken";
import { parse } from "url";
import * as config from "../config.js";
import { getLLModel } from "../llmModels.js";
import * as output from "../output.js";

enum RunMode {
  Content = "content",
  Links = "links",
}

const _gpt2encoding = get_encoding("gpt2");

export async function run(url: string, goal: string, tokenMax: number) {
  try {
    return await _getContent(url, goal, tokenMax);

    //return await _getLinks(url, goal);

    return "";
  } catch (e) {
    output.comment(`llmynx Error: ${e}`);
    return "";
  }
}

async function _getContent(url: string, goal: string, tokenMax: number) {
  let content = await _runLynx(url, RunMode.Content);
  let references = "";

  // Reverse find 'References: ' and cut everything after it from the content
  const refPos = content.lastIndexOf("References");
  if (refPos > 0) {
    references = content.slice(refPos);
    content = content.slice(0, refPos);
  }

  // get the token size of the output
  const contentTokenSize = _gpt2encoding.encode(content).length;
  const refTokenSize = _gpt2encoding.encode(references).length;

  output.comment(`Content Token size: ${contentTokenSize}. 
  References Token size: ${refTokenSize}.
  Goal: ${goal}`);

  if (contentTokenSize < tokenMax) {
    output.comment(`Content is already under ${tokenMax} tokens.`);
    return content;
  }

  const model = getLLModel(config.agent.webModel);

  // For example if context is 16k, and max tokens is 2k, 3k with 1.5x overrun
  // That would be 3k for the current compressed content, 10k for the chunk, and 3k for the output
  const tokenChunkSize = model.maxTokens - tokenMax * 2 * 1.5;

  output.comment(`Token max chunk size: ${tokenChunkSize}`);
  const pieceCount = Math.ceil(contentTokenSize / tokenChunkSize);
  const pieceSize = content.length / pieceCount;
  let reducedOutput = "";

  for (let i = 0; i < pieceCount; i++) {
    const startPos = i * pieceSize;
    const pieceStr = content.substring(startPos, startPos + pieceSize);

    output.comment(`Processing Piece ${i + 1}/${pieceCount}:`);

    output.comment(
      "  Reduced output tokens: " + _gpt2encoding.encode(reducedOutput).length,
    );
    output.comment("  Piece tokens: " + _gpt2encoding.encode(pieceStr).length);

    reducedOutput = await _llmReduce(
      url,
      reducedOutput,
      RunMode.Content,
      goal,
      i + 1,
      pieceCount,
      pieceStr,
      tokenMax,
    );
  }

  const finalTokenSize = _gpt2encoding.encode(reducedOutput).length;

  output.comment(`Final reduced output tokens: ${finalTokenSize}`);

  return reducedOutput;
}

async function _runLynx(url: string, mode: RunMode) {
  return new Promise<string>((resolve) => {
    const modeParams = ""; //mode == RunMode.Content ? "-nolist" : "-listonly";

    exec(`wsl lynx -dump ${modeParams} ${url}`, (error, stdout, stderr) => {
      if (error) {
        resolve(`error: ${error.message}`);
        return;
      }

      if (stderr) {
        resolve(`stderr: ${stderr}`);
        return;
      }

      resolve(stdout);
    });
  });
}

async function _llmReduce(
  url: string,
  reducedOutput: string,
  mode: "content" | "links",
  goal: string,
  pieceNumber: number,
  pieceTotal: number,
  pieceStr: string,
  tokenMax: number,
) {
  const reducedTokenCount = _gpt2encoding.encode(reducedOutput).length;
  const pieceTokenCount = _gpt2encoding.encode(pieceStr).length;

  const model = getLLModel(config.agent.webModel);

  const openai = new OpenAI({
    baseURL: model.baseUrl,
    apiKey: config.openaiApiKey,
  });

  /*let modeMsg = "";
  if (mode == RunMode.Content) {
    modeMsg = `Reformat the page to aid in understanding and navigation. `;
  } else if (mode == RunMode.Links) {
    modeMsg = "Try to keep the most relevant links.";
  }

  let goalMsg = "";
  if (goal) {
    goalMsg = `Try to focus on ${mode} related to ${goal}. `;
  }*/

  /*const completion = await openai.completions.create({
    model: "gpt-3.5-turbo-instruct", // "gpt-3.5-turbo", //"gpt-4", //
    prompt: `You will be iteratively fed the web page ${url} broken into ${pieceTotal} sequential pieces.
    Each piece should be compressed into the previous in order to maintain the meaning of the page and good formatting while reducing verbosity.
    The compressed output should be under ${tokenMax} tokens.
    Links are represented as numbers in brackets. Try to maintain them when reducing the content.
    ${modeMsg}
    ${goalMsg}
    Current compressed content (${reducedTokenCount} tokens): ${reducedOutput}
    Piece ${pieceNumber} of ${pieceTotal} (${pieceTokenCount} tokens): ${pieceStr}
    New compressed content:`,
  });

  return completion.choices[0].text || "";*/

  const chatCompletion = await openai.chat.completions.create({
    model: model.name,
    messages: [
      {
        role: "system",
        content: `You will be iteratively fed the web page ${url} broken into ${pieceTotal} sequential equally sized pieces.
        Each part should be merged into the final content in order to maintain the meaning of the page while reducing verbosity and duplication.
        The final output should be under ${tokenMax} tokens. 
        Try to maintain links which are represented as numbers in brackets.
        Even if you think the character limit has been met, try anyways. 
        `, //${modeMsg}
        //${goalMsg}`,
      },
      {
        role: "user",
        content: `Final content (${reducedTokenCount} tokens): ${reducedOutput}`,
      },
      {
        role: "user",
        content: `Web page part ${pieceNumber} of ${pieceTotal} (${pieceTokenCount} tokens): ${pieceStr}`,
      },
      {
        role: "user",
        content: `Please merge this new part into the existing final content above while keeping the total tokens under ${tokenMax} tokens.`,
      },
      {
        role: "user",
        content: `Just output the new final content to feed into the next iteration.`,
      },
    ],
  });

  return chatCompletion.choices[0].message.content || "";
}

async function _getLinks(url: string, goal: string) {
  const linkOutput = await _runLynx(url, RunMode.Links);

  const uniqueUrls = new Set<string>();

  linkOutput.split("\n").forEach((line) => {
    const urlMatch = line.match(/https?:\/\/\S+/i);
    if (urlMatch && urlMatch[0]) {
      uniqueUrls.add(urlMatch[0]);
    }
  });

  // organize alphabetically
  const yamlLinks = urlsToYaml(Array.from(uniqueUrls).sort()); //.join("\n");
  output.comment(yamlLinks);

  // link tokens
  const linkTokens = _gpt2encoding.encode(yamlLinks).length;
  output.comment(`Link Tokens: ${linkTokens}`);
  output.comment(`Original tokens: ${_gpt2encoding.encode(linkOutput).length}`);

  return yamlLinks;
}

function urlsToYaml(urls: string[]): string {
  const root: Record<string, any> = {};

  for (const urlString of urls) {
    const { hostname, pathname } = parse(urlString);
    if (!pathname || !hostname) continue;

    let currentNode = root;

    if (!currentNode[hostname]) {
      currentNode[hostname] = {};
    }
    currentNode = currentNode[hostname];

    const segments = pathname.split("/").filter(Boolean); // Split and remove empty segments

    for (const segment of segments) {
      if (!currentNode[segment]) {
        currentNode[segment] = {};
      }
      currentNode = currentNode[segment];
    }
  }

  // iternate through yaml str for each instance of {} and replace with an increasing number
  // this is a hack to get around the fact that yaml.dump() doesn't support empty objects
  let counter = 1;
  return yaml
    .dump(root)
    .replace(/: {}/g, () => ` #${counter++}`)
    .replace(/:/g, ""); // replace : with
}
