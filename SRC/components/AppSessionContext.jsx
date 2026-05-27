import React, { createContext, useContext } from 'react';

export const AppSessionContext = createContext({
  formData: {},
  userName: '',
  headerActions: null,
});

export function useAppSession() {
  return useContext(AppSessionContext);
}
