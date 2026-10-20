## Prohibited Actions

1. Writing is prohibited on hard drive locations **_outside this project and its derived WorkTree_**.
2. Installing additional content is prohibited **_without permission_**.
3. Changing existing branches in the project's GIT repository is prohibited **_without permission_**.

## Environment

1. You can retrieve the corresponding environment via the command line.
2. If the command line can't get it, you can check the `E:` directory, which is read-only for you.
3. If neither method provides an available environment, you can request a solution from the user.

## Inside the Project

1. AI-generated content should be placed in the root `.agent` directory. Temporary products should be cleaned up promptly.
2. Before generating, modifying, or deleting project files, prioritize the current status of the .gitignore file. For example, in the first point of this section, the `.agent` directory should be excluded.
3. When the implementation progress of the coding plan in the project reaches important milestones, you should consult the user for review and testing feedback and update the `README.md` document as appropriate.

### Special Note

1. If the project includes the tauri2 library, do not run the `tauri build` command to build the application until reaching the final output stage; instead, perform semantic checks on TypeScript/Rust code using tools such as `tsc` or `cargo check`.

2. File operations: During the project planning phase, first inquire whether a dedicated MCP tool has already been added within the project, and record the corresponding name in the plan document (if applicable). Otherwise, prioritize using PowerShell 7 environment to support UTF-8.
