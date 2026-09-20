*&---------------------------------------------------------------------*
*& Report ZMCP_ADT_FLUSH_CACHE
*&---------------------------------------------------------------------*
*& Gateway OData operations for sp4sap ZMCP_ADT_SRV:
*&   p_flush : cache flush (model + alias)
*&   p_diag  : DPC_EXT direct invocation sanity check
*&   p_reg   : programmatic backend (/IWBEP) service registration
*&             ONLY if Basis hasn't granted /IWBEP/REG_SERVICE and the
*&             Backend Service tab in /IWFND/MAINT_SERVICE is empty.
*&             Normally, Basis should register via the standard TCode.
*&---------------------------------------------------------------------*
REPORT zmcp_adt_flush_cache.

PARAMETERS: p_flush TYPE abap_bool DEFAULT abap_true  AS CHECKBOX,
            p_reg   TYPE abap_bool DEFAULT abap_false AS CHECKBOX,
            p_diag  TYPE abap_bool DEFAULT abap_true  AS CHECKBOX.

DATA lx TYPE REF TO cx_root.

START-OF-SELECTION.

  WRITE: / '=== sp4sap OData Gateway flush + register + diag ==='.
  ULINE.

  IF p_reg = abap_true.
    PERFORM register_backend_service.
    ULINE.
  ENDIF.

  IF p_flush = abap_true.
    PERFORM flush_all_caches.
    ULINE.
  ENDIF.

  IF p_diag = abap_true.
    PERFORM diag_direct_dpc.
    ULINE.
  ENDIF.

  WRITE: / 'Done.'.

FORM register_backend_service.

  WRITE: / '=== Backend service registration (/IWBEP) ==='.

  DATA: ls_ohd TYPE /iwbep/i_mgw_ohd,
        ls_srh TYPE /iwbep/i_mgw_srh,
        ls_srg TYPE /iwbep/i_mgw_srg.
  DATA: lv_ts TYPE tzntstmps.

  GET TIME STAMP FIELD lv_ts.

  ls_ohd-technical_name   = 'ZMCP_ADT_MDL'.
  ls_ohd-version          = '0001'.
  ls_ohd-class_name       = 'ZCL_ZMCP_ADT_MPC_EXT'.
  ls_ohd-created_by       = sy-uname.
  ls_ohd-created_timestmp = lv_ts.
  ls_ohd-changed_by       = sy-uname.
  ls_ohd-changed_timestmp = lv_ts.

  TRY.
      MODIFY /iwbep/i_mgw_ohd FROM ls_ohd.
      IF sy-subrc = 0.
        WRITE: / '[OK]  model OHD row written: ZMCP_ADT_MDL -> ZCL_ZMCP_ADT_MPC_EXT'.
      ELSE.
        WRITE: / '[ERR] OHD MODIFY subrc=', sy-subrc.
      ENDIF.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] OHD MODIFY:', lx->get_text( ).
  ENDTRY.

  ls_srh-technical_name   = 'ZMCP_ADT_SRV'.
  ls_srh-version          = '0001'.
  ls_srh-external_name    = 'ZMCP_ADT_SRV'.
  ls_srh-class_name       = 'ZCL_ZMCP_ADT_DPC_EXT'.
  ls_srh-created_by       = sy-uname.
  ls_srh-created_timestmp = lv_ts.
  ls_srh-changed_by       = sy-uname.
  ls_srh-changed_timestmp = lv_ts.
  ls_srh-service_type     = '0'.
  ls_srh-is_sap_service   = abap_false.

  TRY.
      MODIFY /iwbep/i_mgw_srh FROM ls_srh.
      IF sy-subrc = 0.
        WRITE: / '[OK]  service SRH row written: ZMCP_ADT_SRV -> ZCL_ZMCP_ADT_DPC_EXT'.
      ELSE.
        WRITE: / '[ERR] SRH MODIFY subrc=', sy-subrc.
      ENDIF.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] SRH MODIFY:', lx->get_text( ).
  ENDTRY.

  ls_srg-group_tech_name = 'ZMCP_ADT_SRV'.
  ls_srg-group_version   = '0001'.
  ls_srg-model_tech_name = 'ZMCP_ADT_MDL'.
  ls_srg-model_version   = '0001'.

  TRY.
      MODIFY /iwbep/i_mgw_srg FROM ls_srg.
      IF sy-subrc = 0.
        WRITE: / '[OK]  linkage SRG row written: SRV<->MDL'.
      ELSE.
        WRITE: / '[ERR] SRG MODIFY subrc=', sy-subrc.
      ENDIF.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] SRG MODIFY:', lx->get_text( ).
  ENDTRY.

  COMMIT WORK AND WAIT.
  WRITE: / '[OK]  COMMIT WORK'.

ENDFORM.

FORM flush_all_caches.

  WRITE: / '=== Cache flush ==='.

  TRY.
      /iwbep/cl_v2_cp_facade_factory=>create(
        )->create_config_facade(
        )->delete_all_model_data_cache( ).
      WRITE: / '[OK]  proxy model data cache cleared'.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] proxy model data:', lx->get_text( ).
  ENDTRY.

  TRY.
      /iwfnd/cl_med_mdl_cache_persis=>clean_up(
        iv_log_description = CONV #( 'Flushed by ZMCP_ADT_FLUSH_CACHE' ) ).
      WRITE: / '[OK]  model cache cleaned'.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] model cache:', lx->get_text( ).
  ENDTRY.

  TRY.
      /iwbep/cl_v4_service_alias_fac=>create_for_runtime(
        )->clear_cache( ).
      WRITE: / '[OK]  V4 service alias cache cleared'.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] V4 service alias:', lx->get_text( ).
  ENDTRY.

ENDFORM.

FORM diag_direct_dpc.

  WRITE: / '=== DPC_EXT direct invocation test ==='.

  DATA lo_dpc TYPE REF TO zcl_zmcp_adt_dpc_ext.
  DATA lt_parameter TYPE /iwbep/t_mgw_name_value_pair.
  DATA ls_param     TYPE /iwbep/s_mgw_name_value_pair.

  TRY.
      CREATE OBJECT lo_dpc.
      WRITE: / '[OK]  DPC_EXT instantiated'.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] instantiation:', lx->get_text( ).
      RETURN.
  ENDTRY.

  ls_param-name = 'IV_ACTION'.        ls_param-value = 'READ'.    APPEND ls_param TO lt_parameter.
  ls_param-name = 'IV_PROGRAM'.       ls_param-value = 'RSPARAM'. APPEND ls_param TO lt_parameter.
  ls_param-name = 'IV_LANGUAGE'.      ls_param-value = 'EN'.      APPEND ls_param TO lt_parameter.
  ls_param-name = 'IV_TEXTPOOL_JSON'. ls_param-value = ''.        APPEND ls_param TO lt_parameter.

  TYPES: BEGIN OF ty_res,
           ev_result  TYPE string,
           ev_subrc   TYPE i,
           ev_message TYPE string,
         END OF ty_res.
  DATA ls_expected TYPE ty_res.
  DATA lr_ref TYPE REF TO data.
  GET REFERENCE OF ls_expected INTO lr_ref.

  TRY.
      lo_dpc->/iwbep/if_mgw_appl_srv_runtime~execute_action(
        EXPORTING iv_action_name = 'Textpool'
                  it_parameter   = lt_parameter
        IMPORTING er_data        = lr_ref ).
      WRITE: / '[OK]  execute_action returned no exception'.
    CATCH cx_root INTO lx.
      WRITE: / '[ERR] execute_action:', lx->get_text( ).
  ENDTRY.

ENDFORM.
