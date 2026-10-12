# StarNet v0.13.3

A security update. Everything else stays exactly as it is in 0.13.2. The big feature update (SEND TO between lines, drag-and-drop building, memory and long-chat fixes, clearer stops, local model fixes) is coming next as its own release.

## Security

This release tightens StarNet's local security:

- **Local access checks are stricter.** The station only hands its access key to the app running under your own account, and checks every request.
- **Outside content stays contained.** A run that has read outside content, such as a web page, a webhook or a forwarded message, can't create or change routines or skills, and that content no longer feeds what agents learn on their own. A forwarded Telegram message now counts as outside content.
- **Credential folders are off-limits to file tools.** Agents' file tools can't read well-known credential folders (SSH, GPG, cloud CLIs, saved logins, signing keys) unless you give them Full Power.
- **Imported station configs carry only the permissions you curated.** Standing approvals to run commands, send or spend are skipped and listed in the import notes.
- **Project files are checked before anything is opened**, so a network path in a project can't make the station reach out to another machine first.
- **Code tools are more careful with untrusted projects.** The Rust language server only starts for a project you've chosen to watch.
- **The browser page only runs its own scripts**, and the desktop app holds fewer raw permissions.

Update to get these fixes.
