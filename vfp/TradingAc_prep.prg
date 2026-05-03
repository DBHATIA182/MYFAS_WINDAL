*----------------------------------------------------------------------
* TradingAc_prep.prg
* Call AFTER your TDG logic has built cursor FTDG (same as tdg.frx).
* Produces cursor TRADINGAC: all FTDG columns + average rates + L/R totals.
* Use TRADINGAC as the Report Designer record source for TradingAc.frx.
*----------------------------------------------------------------------
LPARAMETERS tcAlias
LOCAL lcAlias
lcAlias = UPPER(IIF(EMPTY(m.tcAlias), "FTDG", m.tcAlias))
IF !USED(m.lcAlias)
	MESSAGEBOX("TradingAc_prep: cursor " + m.lcAlias + " is not open.", 16, "Trading Account")
	RETURN .F.
ENDIF

SELECT * , ;
	0.00 AS OA_RATE , ;
	0.00 AS PA_RATE , ;
	0.00 AS SA_RATE , ;
	0.00 AS CA_RATE , ;
	0.00 AS L_AMT_TOTAL , ;
	0.00 AS R_AMT_TOTAL , ;
	" " AS ROW_KIND ;
FROM &lcAlias. ;
INTO CURSOR tradingac READWRITE

SELECT tradingac
SCAN
	IF RTRIM(NVL(CODE, "")) == "000000"
		REPLACE ROW_KIND WITH "E" , ;
			L_AMT_TOTAL WITH NVL(DR_AMT, 0) , ;
			R_AMT_TOTAL WITH NVL(CR_AMT, 0)
		LOOP
	ENDIF
	REPLACE ROW_KIND WITH "S"
	REPLACE OA_RATE WITH IIF(NVL(OWGT, 0) <> 0, ROUND(NVL(OAMT, 0) / OWGT, 2), ;
		IIF(NVL(OQTY, 0) <> 0, ROUND(NVL(OAMT, 0) / OQTY, 2), 0))
	REPLACE PA_RATE WITH IIF(NVL(PWGT, 0) <> 0, ROUND(NVL(PAMT, 0) / PWGT, 2), ;
		IIF(NVL(PQTY, 0) <> 0, ROUND(NVL(PAMT, 0) / PQTY, 2), 0))
	REPLACE SA_RATE WITH IIF(NVL(SWGT, 0) <> 0, ROUND(NVL(SAMT, 0) / SWGT, 2), ;
		IIF(NVL(SQTY, 0) <> 0, ROUND(NVL(SAMT, 0) / SQTY, 2), 0))
	REPLACE CA_RATE WITH IIF(NVL(CWGT, 0) <> 0, ROUND(NVL(CAMT, 0) / CWGT, 2), ;
		IIF(NVL(CQTY, 0) <> 0, ROUND(NVL(CAMT, 0) / CQTY, 2), 0))
	REPLACE L_AMT_TOTAL WITH NVL(OAMT, 0) + NVL(PAMT, 0) + NVL(GPROFIT, 0)
	REPLACE R_AMT_TOTAL WITH NVL(SAMT, 0) + NVL(CAMT, 0) + NVL(GLOSS, 0)
ENDSCAN
GO TOP
RETURN .T.
