import React, { createContext, useContext } from 'react';

export const AppSessionContext = createContext({
  formData: {},
  userName: '',
});

export function useAppSession() {
  return useContext(AppSessionContext);
}
