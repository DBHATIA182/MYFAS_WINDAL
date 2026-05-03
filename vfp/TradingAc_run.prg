*----------------------------------------------------------------------
* TradingAc_run.prg
* Preview / print TradingAc.frx after FTDG has been built (DO TDG ...).
*
* Usage:
*   SET PROCEDURE TO "<path>\APPTEST\vfp" ADDITIVE
*   DO TradingAc_run                         && PREVIEW; rebuilds TRADINGAC from FTDG
*   DO TradingAc_run WITH "PRINT"
*   DO TradingAc_run WITH "PREVIEW", .T.    && .T. = skip prep (use FTDG or existing TRADINGAC)
*----------------------------------------------------------------------
LPARAMETERS tcMode, tlSkipPrep
LOCAL lcMode, llSkipPrep, lcForm, lcDataAlias
lcMode = UPPER(TRANSFORM(IIF(PCOUNT() < 1, "PREVIEW", m.tcMode)))
llSkipPrep = IIF(PCOUNT() < 2, .F., m.tlSkipPrep)

IF !m.llSkipPrep
	IF USED("tradingac")
		USE IN SELECT("tradingac")
	ENDIF
	IF USED("ftdg")
		DO TradingAc_prep WITH "FTDG"
	ENDIF
ENDIF

lcDataAlias = IIF(USED("tradingac"), "TRADINGAC", "FTDG")
IF !USED(m.lcDataAlias)
	MESSAGEBOX("TradingAc_run: need FTDG (run TDG first). For skip-prep mode, TRADINGAC or FTDG must be open.", 16, "Trading Account")
	RETURN .F.
ENDIF

SELECT (m.lcDataAlias)
GO TOP

lcForm = FULLPATH("TradingAc.frx")
IF !FILE(m.lcForm)
	MESSAGEBOX("TradingAc_run: file not found:" + CHR(13) + m.lcForm + CHR(13) + ;
		"Copy tdg.frx to TradingAc.frx or build per TradingAc_REPORT_DESIGNER.txt.", 48, "Trading Account")
	RETURN .F.
ENDIF

IF m.lcMode == "PRINT"
	REPORT FORM (m.lcForm) TO PRINTER PROMPT NODIALOG
ELSE
	REPORT FORM (m.lcForm) PREVIEW
ENDIF
RETURN .T.
