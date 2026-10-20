@echo off
REM Inicia o servidor local do aplicativo de relatorio fotografico.
REM Basta dar duplo clique neste arquivo.
title RF Materiais - servidor local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
pause
