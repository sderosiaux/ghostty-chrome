import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_PATHS = [
  join(homedir(), ".config", "ghostty", "config"),
  join(homedir(), "Library", "Application Support", "com.mitchellh.ghostty", "config"),
];

const DEFAULT_THEME = {
  foreground: "#c0caf5",
  background: "#1a1b26",
  cursor: "#c0caf5",
  selectionBackground: "#33467c",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

const COLOR_MAP = {
  "palette = 0": "black",
  "palette = 1": "red",
  "palette = 2": "green",
  "palette = 3": "yellow",
  "palette = 4": "blue",
  "palette = 5": "magenta",
  "palette = 6": "cyan",
  "palette = 7": "white",
  "palette = 8": "brightBlack",
  "palette = 9": "brightRed",
  "palette = 10": "brightGreen",
  "palette = 11": "brightYellow",
  "palette = 12": "brightBlue",
  "palette = 13": "brightMagenta",
  "palette = 14": "brightCyan",
  "palette = 15": "brightWhite",
};

export function parseTerminalConfig() {
  const config = { theme: { ...DEFAULT_THEME }, font: {}, shell: null };

  for (const p of CONFIG_PATHS) {
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf-8").split("\n");

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();

      if (key === "foreground") config.theme.foreground = val;
      else if (key === "background") config.theme.background = val;
      else if (key === "cursor-color") config.theme.cursor = val;
      else if (key === "selection-background") config.theme.selectionBackground = val;
      else if (key === "font-family") config.font.family = val;
      else if (key === "font-size") config.font.size = parseFloat(val);
      else if (key === "command") config.shell = val;
      else if (key.startsWith("palette")) {
        // palette = N=COLOR format
        const parts = val.split("=");
        if (parts.length === 2) {
          const colorKey = COLOR_MAP[`palette = ${parts[0].trim()}`];
          if (colorKey) config.theme[colorKey] = parts[1].trim();
        }
      }
    }
    break; // use first found config
  }

  return config;
}
