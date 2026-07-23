# toka-plugins

A small compilations of [Claude Code](https://claude.com/claude-code) plugins for myself

## Plugins

### discord-extras

Companion to the official [`discord` channel plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord).
Adds a features the official plugin doesn't have yet. 
Basically for now, it just adds a functionality to create thread, but I'll add features that I think is useful.

BTW ofc it's 100% vibe-coded since I know nothing about typescript.

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
