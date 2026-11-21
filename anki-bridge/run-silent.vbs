Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c cd /d """ & dir & """ && node sync.mjs >> """ & dir & "\bridge.log"" 2>&1"
shell.Run cmd, 0, False
