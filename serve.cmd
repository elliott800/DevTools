@echo off
REM DevTools local dev server launcher (cmd wrapper around serve.js).
REM Usage: serve <site> [options]   e.g.  serve www.test.com   |   serve --list
node "%~dp0serve.js" %*
