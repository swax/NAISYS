## Contributing

- Start a discussion to propose changes
- Once agreed create an issue to track the change
- Fork the repository to make the change
- Commit messages should be descriptive and reference the issue number
- Create a pull request
  - Provide validation evidence and/or tests if possible
  - Perform any modifications per the code review
- Once the PR is approved, it will be merged into the main branch

## Code Design Notes

- The entry point is in `src/naisys.ts`
- LLM configurations are in the `src/llm/llmModels.ts` file
- A helpful `dependency-graph.png` is included to get an idea of the overall architecture
  - This also doubles as a way to prevent cyclic dependencies as a DI library is not used currently
- The code is organzied into module based services
  - Think poor mans singleton dependency injection
  - A previous version had class based services using real DI, but made the code a soup of `this.` statements
  - Code from these services are imported with \* so it's clear when you're calling out to a service like llmService.send()
- There is a command loop that first checks for internally handled NAISYS commands, unhandled commands fall through to an actual shell
  - Multiline commands are added to a temporary shell script and then executed so it's easier to pinpoint where a command failed by line number in the script versus the entire shell log
- Various sqlite databases are used for logging, cost tracking and mail. All stored in the `{NAISYS_FOLDER}/lib` folder
- There are examples of tests in the `src/__tests__` folder
  - They demonstrate how to mock modules in jest
