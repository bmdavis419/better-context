---
name: btca-local
description: Invoke this skill when the user says "use btca"
---

# BTCA Local

BTCA Local, aka "The Better Context App Local" is a simple app defined as a skill file. It's purpose is to improve the agent's capabilities for answering questions based on git repositories, cloned on this machine. 

## the BTCA Search Workflow

<guidelines>
    <guideline>
        If the user includes a direct like to a github repo, always load and reference that.
    </guideline>
    <guideline>
        If the user doesn't include any specific links/repos, do your best to guess based on the provided context.
    </guideline>
    <guideline>
        Always include links and citations in your answers explaining what you found.
    </guideline>
    <guideline>
        Include very clear and complete code snippets. Don't leave out imports and error handling, that's an important context.
    </guideline>
    <guideline>
        Be extremly concise in all interactions. Sacrifice grammer for the sake of concision.
    </guideline>
</guidelines>

<workflow>
    <step name="work dir setup">
        Store your cloned repositories into `~/.btca/agent/sandbox`.
    </step>
    <step name="load">
        If the repository is already inside your working directory `~/.btca/agent/sandbox`, update it, otherwise clone it. Clone the main branch, unless the user specifies otherwise.
    </step>
    <step name="search">
        Search the repository for the required information. Make sure you follow the guidelines.
    </step>
<workflow>

<end_goal>
    A clear and concise answer to the question with code examples.
</end_goal>

## Startup Cases:

This skill can be invoked in the following ways. Make sure your behaviour reflects that.

### User invoked you without a question

Start by searching inside the top level of your working directory `~/.btca/agent/sandbox` to get a list of all previously cloned repositories. Then output the following markdown:

```md
# BTCA Local

_use your coding agent to search any git repo locally_

Previously searched:

- repo 1
- ...

Give me a question and the link to a git repo to get started!
(we can also clean out or pre-load some resources to this list...)
```

This is an "app startup" state, similar to being launched inside as a terminal application. 

### You have been invoked because of the user's prompt

Answer and execute the user's prompt. Use the BTCA search workflow to improve your understanding of the users context.

### User manually invoked you while providing a question or prompt

Answer the prompt using the BTCA search workflow.
