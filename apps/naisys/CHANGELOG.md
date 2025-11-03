# Changelog

All notable changes to this project will be documented in this file. The format of this file is defined [here](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2024-03-08

- Added `commandProtection` to agent configuration. This can be set to `none`, `manual`, or `auto`
  - `manual` asks for user confirmation before running a command
  - `auto` validates the command through a separate LLM, denying any commands that look like they'll modify the system
