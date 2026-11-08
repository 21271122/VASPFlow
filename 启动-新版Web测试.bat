@echo off
setlocal
title VASPFlow / DSH 0.2.2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dsh-profile.ps1" -ProfileName web-dev
if errorlevel 1 pause
