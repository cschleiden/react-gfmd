import { unicodeEmojiByName } from "./unicode-data";

export interface EmojiDefinition {
  emoji: string | null;
  imageUrl: string | null;
  name: string;
}

// GitHub emoji API aliases whose assets do not have a Unicode equivalent.
const customEmojiNames = new Set([
  "accessibility",
  "atom",
  "basecamp",
  "basecampy",
  "bowtie",
  "copilot",
  "dependabot",
  "electron",
  "feelsgood",
  "finnadie",
  "fishsticks",
  "goberserk",
  "godmode",
  "hurtrealbad",
  "neckbeard",
  "octocat",
  "rage1",
  "rage2",
  "rage3",
  "rage4",
  "shipit",
  "suspect",
  "trollface",
]);

export function emojiDefinition(name: string): EmojiDefinition | null {
  if (customEmojiNames.has(name)) {
    return {
      emoji: null,
      imageUrl: `https://github.githubassets.com/images/icons/emoji/${name}.png`,
      name,
    };
  }

  const emoji = unicodeEmojiByName[name];
  return emoji ? { emoji, imageUrl: null, name } : null;
}

export function emojiShortcode(name: string) {
  return `:${name}:`;
}
