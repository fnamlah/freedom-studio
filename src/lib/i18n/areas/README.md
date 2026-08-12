# Per-area dictionaries

One file per product area, holding BOTH languages side by side:

```ts
// src/lib/i18n/areas/<area>.ts
export const <area>En = {
  title: "Library",
  count: (n: number) => `${n} files`,
};

export const <area>Ru: typeof <area>En = {
  title: "Библиотека",
  count: (n: number) => `${n} ${plural(...)}`,
};
```

`typeof <area>En` on the Russian object is the completeness gate — a missing or
misspelled key, or a function whose signature drifted, fails the build.

Both languages live in one file on purpose: a translator sees the English and
the Russian on adjacent lines, which is how you catch a wrong word. Splitting
them into `en/` and `ru/` trees puts the two halves of every decision in two
places.

`../en.ts` and `../ru.ts` compose these; nothing else imports them directly.
