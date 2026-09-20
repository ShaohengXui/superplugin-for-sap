*&---------------------------------------------------------------------*
*&  Include           Y_DEV2401_04C
*&---------------------------------------------------------------------*
CLASS LCL_DATA DEFINITION DEFERRED.
DATA GO_DATA TYPE REF TO LCL_DATA.

CLASS LCL_DATA DEFINITION.

  PUBLIC SECTION.

    DATA : MT_DATA TYPE TABLE OF TY_LIST.
    DATA : MT_HEADER TYPE TABLE OF TY_HEADER.

    METHODS :
      CONSTRUCTOR,
      GET_DATA.
    PRIVATE SECTION.
      DATA : MT_NKEY TYPE TABLE OF ty_node.

ENDCLASS.


CLASS LCL_DATA IMPLEMENTATION.

  METHOD CONSTRUCTOR.

    "Selection Screen 등록
    LV_001 = 'Screen 100'.
    LV_002 = 'Screen 200'.
*    LV_003 = 'Screen 300'.

  ENDMETHOD.


  METHOD GET_DATA.

    SELECT EKKO~EBELN,
           EKKO~BSART,
           EKKO~LIFNR,
           EKPO~EBELP,
           EKPO~MENGE,
           EKPO~MEINS,
           EKPO~NETPR
      FROM EKKO
      INNER JOIN EKPO
              ON EKKO~EBELN = EKPO~EBELN
      WHERE LIFNR <> @SPACE
      INTO CORRESPONDING FIELDS OF TABLE @MT_DATA
      UP TO 100 ROWS.



  ENDMETHOD.


ENDCLASS.
