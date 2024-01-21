## NAISYS (Node.js Autonomous Intelligence System)

Testing the limits of cognitive architectures with LLMs. The goal is to see how far a LLM can
get into writing an website from scratch as well as work with other LLM agents on the same project.

Since the LLM has a limited context, a shell built for it should take this into account and help the LLM
perform 'context friendly' operations. For example reading/writing a file can't use a typical editor like 
vim or nano so point the LLM to use cat to read/write files in a single operation. 

Node.js is used to create a simple shell environment for the LLM that
- Helps the LLM keep track of its current context size
- Give the LLM the ability to 'reset' the context and carry over information to a new session/context
- Proxy commands to a real shell, and help guide the LLM to use context friendly commands
- Prevent the context from being polluted by catching common errors like output that includes the command prompt itself

Console Colors
- Purple: Response from GPT, added to context
- White: Generated locally or from a real shell, added to context
- Green: Root prompt and root command reponses. Not added to context. Used for diagnostics between calls to GPT
- Red: Processing errors, not added to context (Not shell errors which are on the context)
