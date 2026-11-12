# Rule: keep the repository tidy

- **Know where a new file goes before you create it.** Each kind (components, screens, services or domain rules, hooks
  or helpers, tests, scripts, docs) has one home, named in the project's overview document (`AGENTS.md`). Never leave a
  loose file where nothing of its kind lives.
- **Look before you create.** Search for an existing helper, constant, component or category first and reuse it. If none
  fits, add a clearly named new folder and list it in the overview document.
- **Extract on the second occurrence**, and split a file that passes about 300 lines or mixes two concerns.
- **Layers point one way.** Entry points and screens may use components, helpers and services; those never import back
  from the screens. Contexts or stores hold state, not business rules.
- **Tests sit beside what they test** (same folder, same name plus `.test`), not in a far-away folder.
- **Barrel or index files** (if the project uses them) re-export one thing per folder; import from the folder, never
  from a deep path.
- **Update the map in the same change.** When you add, move or remove a folder or a key file, update the architecture
  list in the overview document so it stays true.
