*&---------------------------------------------------------------------*
*& Sample Report Program Template
*& Program  : ZRSP4SAP_OOP_EX
*& Author   : SVT_00005
*& Date     : 2026-04-03
*& S/4HANA  : 2025 Release
*& Version  : v1.0 - Include Structure Change Completed
*& Desc     : Sample Report Program Template
*&            
*&            
*&---------------------------------------------------------------------*
REPORT ZRSP4SAP_OOP_EX.


INCLUDE ZRSP4SAP_OOP_EXT.
INCLUDE ZRSP4SAP_OOP_EXS.
INCLUDE ZRSP4SAP_OOP_EXC.
INCLUDE ZRSP4SAP_OOP_EXA.
INCLUDE ZRSP4SAP_OOP_EXE.
INCLUDE ZRSP4SAP_OOP_EXO.
INCLUDE ZRSP4SAP_OOP_EXI.
INCLUDE ZRSP4SAP_OOP_EXF.
INCLUDE ZRSP4SAP_OOP_EXTST. "Test Class


*&---------------------------------------------------------------------*
*& INITIALIZATION
*&---------------------------------------------------------------------*
INITIALIZATION.
  GO_DATA = NEW #( ).
  GO_ALV  = NEW #( ).


*&---------------------------------------------------------------------*
*& AT SELECTION-SCREEN
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN.

*&---------------------------------------------------------------------*
*& AT SELECTION-SCREEN OUTPUT 
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN OUTPUT.

*&---------------------------------------------------------------------*
*& AT SELECTION-SCREEN
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN OUTPUT FOR FIELD P_FILE.

*   GO_DATA->GET_FILE( P_FILE ).

*&---------------------------------------------------------------------*
*& START-OF-SELECTION
*&---------------------------------------------------------------------*
START-OF-SELECTION.

  GO_DATA->GET_DATA( ).

*&---------------------------------------------------------------------*
*& END-OF-SELECTION
*&---------------------------------------------------------------------*
END-OF-SELECTION.

  GO_ALV->DISPLAY( ).
