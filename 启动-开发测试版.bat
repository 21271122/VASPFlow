@echo off
setlocal
title VASPFlow Development
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dsh-profile.ps1" -ProfileName web-dev -DisplayName "VASPFlow development profile"
if errorlevel 1 pause
