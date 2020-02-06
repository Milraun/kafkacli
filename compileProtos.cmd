@echo on  
rem ======================================================================  
::  
::  [2do: compileProtos]  
::  Jürgen Bockhorn
::  
::  Skript zum compilieren der VMIS2 Protos für kafkacli
::  Ohne Parameter cloned das Skript das repository vmis2-kersystem-schmea aus dem gitlab 
::  und compiliert den neusten Stand nach vmis2proto.json
::  Parameter %1% würde ein konkretes tag auschecken und übersetzten
::  Parameter %2% würde eine alternative Ausgabedatei schreiben
::
::  Usage: compileProtos [[tag] outputFile]
rem ----------------------------------------------------------------------  
::  History  
::  V1.0 - 2020-02-06  initial version  
rem ======================================================================  
set OUTFILE=vmis2proto.json
if not [%1] == [] if not [%2] == [] set OUTFILE=%2
rm -rf vmis2-kernsystem-schema
rm -rf vmis2-proto
git clone git@gitlab.heuboe.hbintern:VMIS2/online-datenhaltung/vmis2-schema-repository/vmis2-kernsystem-schema.git
cd vmis2-kernsystem-schema
if [%1] == [] goto noTag
	git checkout tags/%1 -b %1
:noTag
cmd /C mvn.cmd dependency:unpack-dependencies@jaybee -Dmdep.unpack.includes=**/*proto -DoutputDirectory=../vmis2-proto
cd ..
npx pbjs -t json vmis2-proto/*.proto > %OUTFILE%
