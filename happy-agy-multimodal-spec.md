# Spec: Multimodal (Image) Support for the `agy` Provider

## Context
Happy's desktop UI supports dragging and dropping images into the chat. The `claude` provider handles this by draining these attachments (`session.drainAttachmentsForUserMessage()`) and pushing them directly into the Anthropic API payload as `ContentBlockParam` (base64 image blocks).

However, the `agy` provider currently ignores these attachments. The `agy` CLI (`agy --print`) is text-first and does not have a native `--attachment` flag to accept base64 image data directly through the command line.

## Proposed Architecture

Since the `agy` CLI relies on agentic tools (like `view_file`) to interact with the environment, we can support multimodality by **materializing the attachments into real files** and injecting their paths into the prompt. The Antigravity agent will then naturally use its file-reading capabilities to "see" the images.

### 1. Attachment Interception (`runAgy.ts`)
When a user message arrives in `session.onUserMessage`:
- Call `const attachments = await session.drainAttachmentsForUserMessage();`
- If attachments exist, process them before queueing the message.

### 2. File Materialization
- Create a dedicated temporary directory for attachments: `~/.happy/tmp/attachments/`.
- For each attachment in the array (which contains `data: Uint8Array`, `mimeType`, `name`), write the `Uint8Array` buffer to disk.
- Generate a unique filename (e.g., `<uuid>-<original-name>`) to prevent collisions.

### 3. Prompt Injection
- Append a standard footer to the user's prompt text to inform the agent about the materialized files:
  
  ```text
  {Original User Prompt}
  
  ---
  [System: The user attached the following files to this message. You can view them using your file reading tools:]
  - /Users/.../.happy/tmp/attachments/123-screenshot.png
  ```
- Push this augmented prompt to the `messageQueue`.

### 4. Agent Execution (`AgyBackend.ts`)
- The `messageQueue` will batch the augmented text and pass it to `AgyBackend.sendPrompt`.
- `AgyBackend` spawns `agy --print "<augmented_prompt>"`.
- The `agy` agent receives the prompt, sees the file paths, and autonomously uses its `view_file` tool to ingest the images before answering.

## Implementation Steps
1. **Modify `runAgy.ts`**:
   - Import `fs` and `path`.
   - Ensure the `~/.happy/tmp/attachments` directory exists.
   - Update `session.onUserMessage` to fetch and write attachments to disk.
   - Augment `message.content.text` if attachments are present.
2. **Cleanup (Optional but recommended)**:
   - Implement a cleanup routine (e.g., in `reaper` or during daemon startup) to clear old attachments from `~/.happy/tmp/attachments` older than a few days, preventing disk bloat.

## Why this approach?
- **Zero changes to `agy` CLI**: It leverages the agent's existing tool-calling capabilities (`view_file` natively supports images).
- **High Compatibility**: Works for images, PDFs, or any future file types the UI might allow dragging in, as long as the agent's file reader supports it.
- **Traceability**: Users and developers can easily inspect the `~/.happy/tmp/attachments` directory if an image fails to load.
