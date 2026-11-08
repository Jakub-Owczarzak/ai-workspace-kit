# Rule: readable, self-documenting code

Applies to every line you write or change, in any language.

- **Code reads like a book.** Names are full words, never abbreviations or shortcuts: `quantity`, not
  `qty`; `currentTransform`, not `prev`; `nextProduct`, not `p`; `finishMultiplier`, not `finishMult`;
  `imageUri`, not `uri`.
- **A reader knows what each thing is** from its name and types alone: what a function does, what each
  argument and variable stands for. If a name needs a comment to be understood, rename it.
- **Explain the non-obvious, briefly.** A formula, a state-update trick, a platform workaround or a
  surprising constraint gets a short comment saying what it does and why. Do not comment the obvious.
- **One source of truth.** A constant, table or rule is defined once and imported. Never copy a number
  or a list. Name a magic number.
- **Small units.** One concern per function and per file. Split a file that grows past about 300 lines or
  mixes two concerns. Extract code the second time it appears.
- **Pure rules stay pure.** Business rules (prices, sizing, parsing, formatting, validation) live in
  plain functions with no framework or I/O, with tests beside them. Glue code (storage, network,
  platform) is separate and thin.
- **Handle failure on purpose.** Decide at each boundary whether an error is fatal, retried, or logged and
  swallowed, and say so in the code. Never an empty `catch`.
- **No literal user-facing text in components** when the project has a translation layer: use keys.
- **Scope:** apply this to what you write or touch. Fix abbreviations in the lines you change; do not
  retrofit untouched code unasked.
