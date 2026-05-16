
/** Sales order (SORDER TYPE=SO): DAL.USERS F12 — pos 1–4 = open, add, edit, delete. */
const SALES_ORDER_TYPE = 'SO';

async function fetchSalesOrderUserF12String(user_name, comp_uid) {
  const u = String(user_name || '').trim().toUpperCase();
  if (!u) return { f12: '', source: 'empty_user' };
  const schemas = isEffectiveCompUid(comp_uid) ? [String(comp_uid).trim(), null] : [null];
  const tables = ['DAL.USERS', 'USERS'];
  for (const sch of schemas) {
    for (const t of tables) {
      const sql = `SELECT F12 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`;
      try {
        const rows = await runQuery(sql, { u }, sch, { suppressDbErrorLog: true });
        const raw = rows?.[0]?.F12 ?? rows?.[0]?.f12;
        if (raw != null && String(raw).trim() !== '') {
          return { f12: String(raw).trim(), source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) {
          /* ignore */
        }
      }
    }
  }
  return { f12: '', source: 'none' };
}

function salesOrderPermissionsFromF12(f12) {
  const s = String(f12 || '');
  const bit = (i) => (s.length > i ? s.charAt(i) === '1' : false);
  if (!s) {
    return { canOpen: true, canAdd: true, canEdit: true, canDelete: true, flags: 'legacy_no_f12' };
  }
  return {
    canOpen: bit(0),
    canAdd: bit(1),
    canEdit: bit(2),
    canDelete: bit(3),
    flags: 'f12',
  };
}

app.get('/api/sales-order-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f12, source } = await fetchSalesOrderUserF12String(user_name, comp_uid);
    res.json({ f12, source, ...salesOrderPermissionsFromF12(f12) });
  } catch (err) {
    console.error('❌ sales-order-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-form-context', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const row = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!row) return res.status(404).json({ error: 'compdet row not found' });
    const tv = (k) => {
      const v = rowValueCI(row, k);
      if (v == null || typeof v === 'object') return null;
      return String(v).trim();
    };
    res.json({
      G_COMP_YEAR: Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0,
      G_AMT_CAL: String(tv('amt_cal') ?? 'K').trim().toUpperCase() || 'K',
      COMP_S_DT: tv('comp_s_dt'),
      COMP_E_DT: tv('comp_e_dt'),
      MTYPE: SALES_ORDER_TYPE,
    });
  } catch (err) {
    console.error('❌ sales-order-form-context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-lookups', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const customerSql = `
      SELECT M.CODE, M.NAME, M.CITY
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
      ORDER BY M.NAME, M.CITY, M.CODE`;
    const markaSql = `SELECT DISTINCT TRIM(MARKA) AS MARKA FROM marka WHERE COMP_CODE = :comp_code ORDER BY 1`;
    const itemSql = `
      SELECT ITEM_CODE, ITEM_NAME, NVL(UNIT_WGT, 0) AS UNIT_WGT
      FROM ITEMMAST
      WHERE COMP_CODE = :comp_code
      ORDER BY ITEM_NAME, ITEM_CODE`;
    const [customers, markas, items] = await Promise.all([
      runQuery(customerSql, { comp_code }, comp_uid),
      runQuery(markaSql, { comp_code }, comp_uid).catch(() => []),
      runQuery(itemSql, { comp_code }, comp_uid).catch(() => []),
    ]);
    res.json({ customers: customers || [], markas: markas || [], items: items || [] });
  } catch (err) {
    console.error('❌ sales-order-lookups error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-next-so-no', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const sql = `
      SELECT NVL(MAX(TO_NUMBER(TRIM(TO_CHAR(A.SO_NO)))), 0) + 1 AS NEXT_SO_NO
      FROM SORDER A
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    const n = rows?.[0]?.NEXT_SO_NO ?? rows?.[0]?.next_so_no ?? 1;
    res.json({ next_so_no: Number(n) || 1 });
  } catch (err) {
    console.error('❌ sales-order-next-so-no error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-raw', async (req, res) => {
  try {
    const { comp_code, comp_uid, so_no } = req.query;
    if (!comp_code || comp_uid == null || so_no == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and so_no are required' });
    }
    const sql = `
      SELECT A.*, B.NAME, B.CITY, C.ITEM_NAME
      FROM SORDER A
      LEFT JOIN MASTER B ON B.COMP_CODE = A.COMP_CODE AND B.CODE = A.CODE
      LEFT JOIN ITEMMAST C ON C.COMP_CODE = A.COMP_CODE AND C.ITEM_CODE = A.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'
        AND TRIM(TO_CHAR(A.SO_NO)) = TRIM(TO_CHAR(:so_no))
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code, so_no: String(so_no).trim() }, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ sales-order-raw error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-print', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, s_no, e_no } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date (DD-MM-YYYY) are required' });
    }
    const sno = Math.max(0, Math.floor(Number(s_no) || 0));
    const eno = Math.max(sno, Math.floor(Number(e_no) || 0));
    const sql = `
      SELECT A.TYPE, A.SO_DATE, A.SO_NO, A.CODE,
        B.NAME, B.ADD1, B.ADD2, B.CITY, B.GST_NO, B.PAN, B.TEL_NO_O,
        A.TRN_NO, A.ITEM_CODE, C.ITEM_NAME, A.MARKA, C.HSN_CODE, A.STATUS,
        A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        A.PO_NO, A.REMARKS, A.REMARKS2
      FROM SORDER A
      LEFT JOIN MASTER B ON B.COMP_CODE = A.COMP_CODE AND B.CODE = A.CODE
      LEFT JOIN ITEMMAST C ON C.COMP_CODE = A.COMP_CODE AND C.ITEM_CODE = A.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'
        AND TO_NUMBER(TRIM(TO_CHAR(A.SO_NO))) >= :sno
        AND TO_NUMBER(TRIM(TO_CHAR(A.SO_NO))) <= :eno
        AND TRUNC(A.SO_DATE) >= TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY'))
        AND TRUNC(A.SO_DATE) <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
      ORDER BY A.SO_NO, A.TRN_NO`;
    const rows = await runQuery(
      sql,
      {
        comp_code,
        sno,
        eno,
        s_date: String(s_date).trim(),
        e_date: String(e_date).trim(),
      },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ sales-order-print error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-order-list-report', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, code, item_code, marka } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date (DD-MM-YYYY) are required' });
    }
    const binds = {
      comp_code,
      s_date: String(s_date).trim(),
      e_date: String(e_date).trim(),
    };
    let extra = '';
    const partyCode = code != null && String(code).trim() !== '' ? parseMasterCodeForSql(code) : undefined;
    if (partyCode !== undefined) {
      binds.party_code = partyCode;
      extra += ` AND TRIM(TO_CHAR(A.CODE)) = TRIM(TO_CHAR(:party_code))`;
    }
    const itemTrim = item_code != null ? String(item_code).trim() : '';
    if (itemTrim) {
      binds.item_code = itemTrim;
      extra += ` AND TRIM(A.ITEM_CODE) = TRIM(:item_code)`;
    }
    const markaTrim = marka != null ? String(marka).trim() : '';
    if (markaTrim) {
      binds.marka = markaTrim;
      extra += ` AND TRIM(NVL(A.MARKA, ' ')) = TRIM(:marka)`;
    }
    const sql = `
      SELECT A.SO_NO, A.SO_DATE, A.CODE, B.NAME AS PARTY_NAME,
        A.ITEM_CODE, NVL(C.ITEM_NAME, A.ITEM_CODE) AS ITEM_NAME, A.MARKA,
        A.QNTY, A.STATUS, A.WEIGHT, A.RATE, A.AMOUNT, A.TRN_NO,
        A.PO_NO, A.REMARKS, A.REMARKS2
      FROM SORDER A
      LEFT JOIN MASTER B ON B.COMP_CODE = A.COMP_CODE AND B.CODE = A.CODE
      LEFT JOIN ITEMMAST C ON C.COMP_CODE = A.COMP_CODE AND C.ITEM_CODE = A.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'
        AND TRUNC(A.SO_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        ${extra}
      ORDER BY A.SO_DATE, A.SO_NO, A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ sales-order-list-report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales-order-save', async (req, res) => {
  let conn;
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code || '').trim();
    const comp_uid = String(body.comp_uid || '').trim();
    const user_name = String(body.user_name || '').trim().toUpperCase();
    const mode = String(body.mode || '').trim().toLowerCase();
    const so_date = String(body.so_date || '').trim();
    const so_no = body.so_no;
    const header = body.header && typeof body.header === 'object' ? body.header : {};
    const linesIn = Array.isArray(body.lines) ? body.lines : [];

    if (!comp_code || !comp_uid || !user_name || !['add', 'edit', 'delete'].includes(mode)) {
      return res.status(400).json({ error: 'comp_code, comp_uid, user_name, mode=add|edit|delete required' });
    }
    if (!so_date) return res.status(400).json({ error: 'so_date (DD-MM-YYYY) required' });

    const { f12 } = await fetchSalesOrderUserF12String(user_name, comp_uid);
    const perms = salesOrderPermissionsFromF12(f12);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access denied (F12 position 1).' });
    if (mode === 'add' && !perms.canAdd) return res.status(403).json({ error: 'You cannot add (F12 position 2).' });
    if (mode === 'edit' && !perms.canEdit) return res.status(403).json({ error: 'You cannot edit (F12 position 3).' });
    if (mode === 'delete' && !perms.canDelete) return res.status(403).json({ error: 'You cannot delete (F12 position 4).' });

    const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!compdet) return res.status(400).json({ error: 'compdet not found' });
    const comp_year = Number(compdet?.COMP_YEAR ?? compdet?.comp_year ?? 0) || 0;
    const fy = assertSaleBillDateInFinancialYear(so_date, compdet);
    if (!fy.ok) return res.status(400).json({ error: fy.error });

    const connCfg = {
      user: comp_uid,
      password: comp_uid,
      connectString: activeDbConfig.connectString,
    };
    conn = await getDbConnection(connCfg);

    const delSql = `
      DELETE FROM SORDER A
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'
        AND TRIM(TO_CHAR(A.SO_NO)) = TRIM(TO_CHAR(:so_no))`;

    if (mode === 'delete') {
      if (so_no == null) return res.status(400).json({ error: 'so_no required for delete' });
      await conn.execute(delSql, { comp_code, so_no: String(so_no).trim() }, { autoCommit: false });
      await conn.commit();
      return res.json({ ok: true, mode: 'delete' });
    }

    let so_no_use = so_no;
    if (mode === 'add') {
      const manualSn = so_no != null && String(so_no).trim() !== '';
      if (manualSn) {
        so_no_use = String(so_no).trim();
        const exRows = await conn.execute(
          `SELECT COUNT(*) AS CNT FROM SORDER A
           WHERE A.COMP_CODE = :cc
             AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'
             AND TRIM(TO_CHAR(A.SO_NO)) = TRIM(TO_CHAR(:sn))`,
          { cc: comp_code, sn: so_no_use },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const cnt = Number(exRows.rows?.[0]?.CNT ?? exRows.rows?.[0]?.cnt) || 0;
        if (cnt > 0) {
          await conn.rollback();
          return res.status(400).json({ error: `Sales order number ${so_no_use} already exists.` });
        }
      } else {
        const maxRows = await conn.execute(
          `SELECT NVL(MAX(TO_NUMBER(TRIM(TO_CHAR(A.SO_NO)))), 0) + 1 AS NB
           FROM SORDER A
           WHERE A.COMP_CODE = :cc
             AND UPPER(TRIM(NVL(TO_CHAR(A.TYPE), 'SO'))) = 'SO'`,
          { cc: comp_code },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        so_no_use = Number(maxRows.rows?.[0]?.NB ?? maxRows.rows?.[0]?.nb) || 1;
      }
    }
    if (so_no_use == null || String(so_no_use).trim() === '') {
      return res.status(400).json({ error: 'so_no required for edit' });
    }

    const code = parseMasterCodeForSql(header.code);
    if (code === undefined) return res.status(400).json({ error: 'Customer code required' });
    const po_no = String(header.po_no ?? '').trim().slice(0, 50);
    const remarks = String(header.remarks ?? '').trim().slice(0, 50);
    const remarks2 = String(header.remarks2 ?? '').trim().slice(0, 50);

    if (mode === 'edit') {
      await conn.execute(delSql, { comp_code, so_no: String(so_no_use).trim() }, { autoCommit: false });
    }

    const linesFiltered = linesIn.filter((raw) => {
      const ic = String(raw?.item_code ?? raw?.ITEM_CODE ?? '').trim();
      return ic !== '';
    });
    if (linesFiltered.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'At least one line with item_code is required' });
    }

    let trn = 1;
    const bindRows = linesFiltered.map((raw) => {
      const L = raw && typeof raw === 'object' ? raw : {};
      const tno = Number(L.trn_no ?? L.TRN_NO ?? trn) || trn;
      trn = tno + 1;
      return {
        comp_code,
        comp_year,
        mtype: SALES_ORDER_TYPE,
        so_date,
        so_no: String(so_no_use).trim(),
        code,
        trn_no: tno,
        item_code: String(L.item_code ?? L.ITEM_CODE ?? '').trim(),
        marka: String(L.marka ?? L.MARKA ?? '').trim(),
        qnty: Number(L.qnty ?? L.QNTY ?? 0) || 0,
        status: String(L.status ?? L.STATUS ?? 'B').trim().toUpperCase().slice(0, 1) || 'B',
        weight: clampDispatchWeightSql(L.weight ?? L.WEIGHT ?? 0),
        rate: Number(L.rate ?? L.RATE ?? 0) || 0,
        amount: clampDispatchAmountSql(L.amount ?? L.AMOUNT ?? 0),
        po_no,
        remarks,
        remarks2,
        user_name,
      };
    });

    const insertSql = `
      INSERT INTO SORDER (
        COMP_CODE, COMP_YEAR, TYPE, SO_DATE, SO_NO, CODE,
        TRN_NO, ITEM_CODE, MARKA, QNTY, STATUS, WEIGHT, RATE, AMOUNT,
        PO_NO, REMARKS, REMARKS2, USER_NAME, ENT_DATE
      ) VALUES (
        :comp_code, :comp_year, :mtype, TO_DATE(:so_date, 'DD-MM-YYYY'), :so_no, :code,
        :trn_no, :item_code, :marka, :qnty, :status, :weight, :rate, :amount,
        :po_no, :remarks, :remarks2, :user_name, SYSDATE
      )`;

    await conn.executeMany(insertSql, bindRows, { autoCommit: false });
    await conn.commit();
    res.json({ ok: true, mode, so_no: so_no_use, lines: bindRows.length });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }
    console.error('❌ sales-order-save error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (_) {}
    }
  }
});
