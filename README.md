# toka-plugins

A small compilations of [Claude Code](https://claude.com/claude-code) plugins for myself

## Plugins

### discord-extras

Companion to the official [`discord` channel plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord).
Adds a features the official plugin doesn't have yet. 
Basically for now, it just adds a few features like creating threads, deleting messages, (all of which not available with the original plugin). I'll add features that I think is useful.

BTW ofc it's 100% vibe-coded since I know nothing about typescript.

## Warning

Don't use this if you touch confidential info, as this plugin just passes information to Discord. Anything Claude sends through these tools (thread names, embeds, messages) ends up on Discord's servers, subject to their [privacy policy](https://discord.com/privacy). Keep it for hobby/personal use.

## Install

Requires [bun](https://bun.sh) and a working install of the official `discord` plugin (configured via `/discord:configure`).
See [this](https://code.claude.com/docs/en/channels#discord)

```
/plugin marketplace add <path-or-git-url-of-this-repo>
/plugin install discord-extras@toka-local
/reload-plugins
```

## License

Apache-2.0
