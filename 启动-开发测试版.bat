@echo off
setlocal
title VASPFlow Development (desktop)
rem Points the DSH desktop profile at this worktree (junction) and starts the app.
rem Client changes: save -> watcher rebuilds -> refresh the page.
rem Host changes (lib/index.js, lib/host/*): run this script again.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-desktop.ps1" -Mode dev
if errorlevel 1 pause