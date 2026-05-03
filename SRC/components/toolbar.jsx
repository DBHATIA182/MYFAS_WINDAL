import React from 'react';

const Toolbar = ({ setView }) => {
  const btnStyle = {
    padding: '8px 12px',
    cursor: 'pointer',
    borderRadius: '4px',
    border: '1px solid #ccc',
    backgroundColor: '#fff',
    fontSize: '14px'
  };

  return (
    <div style={{ background: '#333', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {/* These onClick functions tell React to change the 'view' state */}
      <button onClick={() => setView('welcome')} style={btnStyle}>Main Menu</button>
      <button onClick={() => setView('trial')} style={btnStyle}>Trial Balance</button>
      <button onClick={() => setView('ledger')} style={btnStyle}>Ledger</button>
      
      <button style={{...btnStyle, backgroundColor: '#d9534f', color: 'white'}}>PDF</button>
      <button style={{...btnStyle, backgroundColor: '#25D366', color: 'white'}}>WhatsApp</button>
    </div>
  );
};

export default Toolbar;