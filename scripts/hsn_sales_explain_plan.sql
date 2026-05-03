-- =============================================================================
-- HSN Sales (date-wise) — EXPLAIN PLAN for Oracle XE
-- =============================================================================
-- Run from command line:
--   sqlplus DAL/DAL@XE @hsn_sales_explain_plan.sql
--
-- Or inside SQL*Plus:
--   CONNECT DAL/DAL@XE
--   @scripts/hsn_sales_explain_plan.sql
--
-- If you get "table or view PLAN_TABLE does not exist", run once (path may vary):
--   @%ORACLE_HOME%\rdbms\admin\utlxplan.sql
-- =============================================================================

SET ECHO ON
SET FEEDBACK ON
SET VERIFY ON
SET LINESIZE 200
SET PAGESIZE 5000
SET TRIMSPOOL ON
SET LONG 100000

ALTER SESSION SET NLS_DATE_FORMAT = 'DD-MM-YYYY';

-- Company code (edit if needed). Use digits only; script compares as VARCHAR2 '2'.
DEFINE comp_code = 2
DEFINE s_date    = '01-04-2025'
DEFINE e_date    = '31-12-2025'

PROMPT
PROMPT ========== Cleaning prior plans (STATEMENT_ID HSN_%) ==========
DELETE FROM plan_table WHERE statement_id LIKE 'HSN_%';
COMMIT;

PROMPT
PROMPT ========== EXPLAIN 1 of 3: SALE (same shape as Node /api/hsn-sales-datewise) ==========
EXPLAIN PLAN SET STATEMENT_ID = 'HSN_SALE' FOR
SELECT
      A.TYPE,
      A.BILL_DATE,
      A.BILL_NO,
      NVL(A.B_TYPE, 'N') AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(A.HSN_CODE, '') AS HSN_CODE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
FROM SALE A
LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(D.CODE)
WHERE A.COMP_CODE = '&&comp_code'
  AND UPPER(TRIM(A.TYPE)) IN ('SL', 'CN', 'RC', 'SE')
  AND A.BILL_DATE >= TO_DATE('&&s_date', 'DD-MM-YYYY')
  AND A.BILL_DATE < TO_DATE('&&e_date', 'DD-MM-YYYY') + 1;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'HSN_SALE', 'TYPICAL'));

PROMPT
PROMPT ========== EXPLAIN 2 of 3: DBIKRI ==========
EXPLAIN PLAN SET STATEMENT_ID = 'HSN_DBIKRI' FOR
SELECT
      'GR' AS TYPE,
      A.SV_DATE AS BILL_DATE,
      A.SV_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.AMOUNT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
FROM DBIKRI A
LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.S_CODE) = TRIM(D.CODE)
WHERE A.COMP_CODE = '&&comp_code'
  AND A.SV_DATE >= TO_DATE('&&s_date', 'DD-MM-YYYY')
  AND A.SV_DATE < TO_DATE('&&e_date', 'DD-MM-YYYY') + 1;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'HSN_DBIKRI', 'TYPICAL'));

PROMPT
PROMPT ========== EXPLAIN 3 of 3: JOBWORK ==========
EXPLAIN PLAN SET STATEMENT_ID = 'HSN_JOB' FOR
SELECT
      'GT' AS TYPE,
      A.R_DATE AS BILL_DATE,
      A.R_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.JOB_AMT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
FROM JOBWORK A
LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.CR_CODE) = TRIM(D.CODE)
WHERE A.COMP_CODE = '&&comp_code'
  AND A.R_DATE >= TO_DATE('&&s_date', 'DD-MM-YYYY')
  AND A.R_DATE < TO_DATE('&&e_date', 'DD-MM-YYYY') + 1;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'HSN_JOB', 'TYPICAL'));

PROMPT
PROMPT ========== Done. Look for INDEX RANGE SCAN vs TABLE ACCESS FULL on SALE / DBIKRI / JOBWORK ==========
PROMPT To change company or dates, edit DEFINE comp_code / s_date / e_date at top of this file.

SET ECHO OFF
