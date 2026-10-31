@echo off
setlocal
title VASPFlow Release (desktop)
rem Copies this worktree into the DSH desktop profile (like a normal install) and starts the app.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-desktop.ps1" -Mode release
if errorlevel 1 pause