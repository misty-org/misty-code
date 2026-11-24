# Plugging misty-code into Misty

The Code page was cut out of Misty on 2026-11-22, together with the Lab (misty-lab). This file is the
contract between them: what the page takes from Misty, what Misty kept for it, and how to put it back.

## 1. What misty-code needs from Misty

The files keep Misty's paths, so their imports resolve once they are back in place:

- **The chat's context panel** (`features/agents/context-panel`): the file editor (`editor/EditorPane`), its
  commands (`editor/editor_commands`), its addon types and the `editorAddons` port (`editor/editor_addons`),
  word wrap (`editor/editor_settings`), files, git and the terminal.
- **Agents:** `personal/*`, `conversations/*`, `engines/*`, `runs/*`, `shared-folders/chat_folder` (project
  chats, `chat_open_in_code`), `spaces-gateway/spaces_gateway`, `page/*`, `hub/*`.
- **Shared:** `shared/lib/codemirror/*`, `shared/lib/person_tone`, `shared/lib/device_setting`,
  `shared/platform/tauri`, `@/native/invoke`, `features/settings` and `SettingsControls`, `features/shortcuts`,
  `features/app-windows`, `features/engine-config/EngineMark`.
- **Packages:** `@codemirror/lang-sql`, `@codemirror/lint`, `@codemirror/lsp-client`, `@codemirror/merge`,
  `@replit/codemirror-vim`, `y-codemirror.next` (Misty dropped them; see `package.json` here for versions).

## 2. What Misty kept on purpose

- **The editor seam.** The chat's editor reads its addons from the `editorAddons` port
  (`context-panel/editor/editor_addons.ts`) and uses none while nothing provides it. `code/use_editor_addons.ts`
  is the provider.
- **The page's host.** `features/spaces/apps/page_misty.ts` still builds the `code` page's misty-sdk client, with
  no rooms of its own: the code-session room source and its ticket endpoint are gone, and misty-server no longer
  serves code sessions. Plugged back in, a live session is a room keyed by its session, opened with misty-sdk's
  `room(key, options)` like any app (`live_room.ts` already calls `pageMisty(spaceId, "code").room(sessionId,
  { gc: false })`), and the session list in `code_sessions_api.ts` needs a new home.
- **Project chats.** Chats with a picked project folder stay in `misty.db`; while Code is out they show and run
  as ordinary chats (in the sidebar, with the agent's own voice).
- **`chat_open_in_code`** (`src-tauri/features/engines/open_in_code.rs`), which moves a scratch chat into a project.
- **The `quiet` option** of `assembleAgentPrompt` (`features/agents/bots/bot_prompt.ts`), which project chats used.

## 3. Where Misty mounted it

`integration/misty.patch` turns those files back into what they were. The ones that only carried Code:

| Misty file | What it did there |
| --- | --- |
| `features/agents/methods/AgentWorkspaceFrame.tsx`, `page/use_agents_page_state.ts` | The `code` workspace page and `?view=code` |
| `app/layouts/DesktopLayout/sidebar_pins_store.ts`, `SpaceNavigator.tsx` | Code as a pinned place in the sidebar; project chats kept out of the sidebar's list |
| `app/layouts/DesktopLayout/space_navigation.ts`, `search/UseSearchHits.tsx` | Opening a project chat in Code; Code under Go to |
| `app/layouts/DesktopLayout/WorkspaceCanvas.tsx` | The window's bottom bar, shown on the Code page |
| `app/layouts/DesktopLayout/BottomBarItems.tsx`, `bottom_bar_store.ts` | The Code bar items (vim, live, problems, cursor, language, server, theme, terminal, branch) |
| `app/SettingsSections.tsx`, `features/settings/SettingsRegistry.tsx`, `settings_types.ts` | Settings › Code: Editor and Collaboration |
| `features/agents/index.ts` | `EditorSettings`, `CollaborationSettings`, `openCodeChat`, the bar items |
| `features/agents/conversations/view/AgentMessage.tsx`, `context-panel/AgentContextPanel.tsx`, `SessionPanel.tsx` | Open in Code (card and buttons) |
| `context-panel/files/folder_file_search.ts`, `git/ChangesFileContextMenu.tsx` | Opening a file in Code when it shows |
| `features/agents/runs/local-run/run_body.ts` | Project chats ran quiet |
| `features/agents/tutor/cursor/tutor_handoff.ts` | Project chats kept out of an agent's thread |
| `src-tauri/features/lib.rs`, `app/handlers/more_commands.rs`, `app/lifecycle.rs`, `browser/app_windows/lifecycle.rs` | The `code` module, its commands, closing language servers |
| `src-tauri/Cargo.toml` | `tokio-postgres`, `tokio-postgres-rustls`, `rustls-native-certs` |
| `src-tauri/tauri-permissions/app_commands.in`, `actions/actions.toml` | The 30 `code_*` commands |
| `package.json` | The packages above |

The patch also carries the Lab's hunks in seven files both used (`AgentWorkspaceFrame.tsx`,
`use_agents_page_state.ts`, `features/agents/index.ts`, `sidebar_pins_store.ts`, `SpaceNavigator.tsx`,
`UseSearchHits.tsx`, `tutor_handoff.ts`). Bringing Code back alone, drop the Lab's hunks there, or plug the Lab
back first.

## 4. Plugging it back in

1. Clone misty-code next to Misty.
2. Copy `src/` over Misty's `src/`, `native/src-tauri/features/code` to `src-tauri/features/code`, and
   `native/src-tauri/permissions/autogenerated/*.toml` to `src-tauri/permissions/autogenerated/`.
3. `git apply ../misty-code/integration/misty.patch` from Misty's root. It was written against Misty as of
   2026-11-22; where Misty has moved on, apply the hunks by hand using the table above.
4. Provide the editor's addons: in `src/app/feature_seams.ts`, `editorAddons.provide(useEditorAddons)`
   (from `context-panel/editor/editor_addons` and `code/use_editor_addons`).
5. `npm install` in Misty, then fix the tests that mention Code (they were updated or dropped when it left).
