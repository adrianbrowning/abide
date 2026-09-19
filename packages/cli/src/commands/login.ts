import { AbideError } from "@coldtea/abide-schema";
import { readSecret } from "../lib/secret.js";
import { saveUserKey } from "../lib/credentials.js";
import { Callout } from "../ui/components/Callout.js";
import { showPicker, showStatic } from "../ui/render.js";
import type { PickerItem } from "../ui/components/Picker.js";
import { GATEWAY_KEY_ENV, TYPESAFE_KEY_ENV } from "../lib/constants.js";

type Provider = { name: string; prompt: string };

const TYPESAFE: PickerItem<Provider> = {
  value: { name: TYPESAFE_KEY_ENV, prompt: "TypeSafe API key: " },
  label: "TypeSafe API key",
  hint: "from typesafe.ai",
};

const GATEWAY: PickerItem<Provider> = {
  value: { name: GATEWAY_KEY_ENV, prompt: "Vercel AI Gateway key: " },
  label: "Vercel AI Gateway key",
  hint: "a key you already have",
};

const chooseProvider = async (): Promise<Provider> => {
  if (!process.stdin.isTTY) return TYPESAFE.value;
  const chosen = await showPicker("Which key do you have?", [TYPESAFE, GATEWAY]);
  if (chosen === undefined) throw new AbideError("NO_API_KEY", "no key was chosen");
  return chosen.value;
};

/** Never a flag: a flag lands in shell history and CI logs. */
export const runLogin = async (): Promise<number> => {
  const provider = await chooseProvider();
  const key = await readSecret(provider.prompt);
  if (key === "") throw new AbideError("NO_API_KEY", "nothing was entered");
  const file = saveUserKey(provider.name, key);
  await showStatic(
    Callout({
      tone: "ok",
      title: `${provider.name} saved to ${file} (owner-only). Run abide init next.`,
    }),
  );
  return 0;
};
