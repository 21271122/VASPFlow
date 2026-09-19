@echo off
setlocal
title VASPFlow Release
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dsh-profile.ps1" -ProfileName web -DisplayName "VASPFlow release profile"
if errorlevel 1 pause
