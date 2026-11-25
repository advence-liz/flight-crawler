import axios from 'axios';

function createApi(baseURL: string) {
  const client = axios.create({ baseURL, timeout: 120000 });
  client.interceptors.response.use(response => response.data, error => {
    // Axios errors can contain request headers and response bodies.
    console.error('API Error:', error.code, error.response?.status);
    return Promise.reject(error);
  });
  return client;
}

export default createApi(import.meta.env.VITE_API_BASE_URL || '/api');
// The browser must use the frontend origin for the HttpOnly session cookie.
export const adminApi = createApi('/api');
