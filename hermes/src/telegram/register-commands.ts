import { hermesDict, LOCALES_FOR_MENU, type Locale } from "../lib/i18n.js";
import { setMyCommands } from "./api.js";

/**
 * Publish the bot's command menu — the list Telegram shows when someone types
 * "/" — in both languages.
 *
 * `setMyCommands` existed in the API wrapper from the start but was never
 * called, so the menu was whatever had been typed into BotFather by hand. It is
 * registered here at boot instead, which also means the menu can never drift
 * from the commands the handler actually implements.
 *
 * Telegram scopes menus by the CLIENT's interface language, which is not the
 * same thing as our `profiles.locale` — a Russian-reading user with an English
 * Telegram sees the English menu. That is acceptable: the menu is only a hint,
 * and every actual REPLY is rendered from the profile locale.
 */
function commandsFor(locale: Locale): Array<{ command: string; description: string }> {
  const h = hermesDict(locale);
  return [
    { command: "brief", description: h.helpBrief },
    { command: "compliance", description: h.helpCompliance },
    { command: "balances", description: h.helpBalances },
    { command: "approvals", description: h.helpApprovals },
    { command: "cost", description: h.helpCost },
    { command: "status", description: h.helpStatus },
    { command: "pause", description: h.helpPause },
    { command: "resume", description: h.helpPause },
    { command: "help", description: h.helpHelp },
  ];
}

export async function registerBotCommands(): Promise<void> {
  try {
    // Default list (no language_code) is English; Russian clients get the ru list.
    await setMyCommands(commandsFor("en"));
    for (const locale of LOCALES_FOR_MENU) {
      await setMyCommands(commandsFor(locale), locale);
    }
    console.info("[telegram] command menu registered (en + ru)");
  } catch (e) {
    // A cosmetic menu must never stop the worker from starting.
    console.warn("[telegram] could not register commands:", e instanceof Error ? e.message : e);
  }
}
