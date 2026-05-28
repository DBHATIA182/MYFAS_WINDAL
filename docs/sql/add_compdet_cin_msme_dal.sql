-- DAL.COMPDET: CIN and MSME registration for sale bill print header.
-- Run once on Oracle (SQL*Plus / SQL Developer) as schema DAL or with rights on DAL.COMPDET.

-- CIN (Corporate Identification Number)
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE dal.compdet ADD (cin_no VARCHAR2(21))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF; -- ORA-01430 column already exists
END;
/

-- MSME (Udyam / MSME registration — stored as MSME_no per requirement)
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE dal.compdet ADD (MSME_no VARCHAR2(50))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/

COMMENT ON COLUMN dal.compdet.cin_no IS 'Company CIN for invoice header';
COMMENT ON COLUMN dal.compdet.MSME_no IS 'MSME / Udyam registration for invoice header';

-- Example data (adjust COMP_CODE / COMP_YEAR / COMP_UID):
-- UPDATE dal.compdet SET cin_no = 'U12345AB2020PTC123456', MSME_no = 'UDYAM-XX-00-1234567' WHERE comp_code = '01' AND comp_year = 2025;
