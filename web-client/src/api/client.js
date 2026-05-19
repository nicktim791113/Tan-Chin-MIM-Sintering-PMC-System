let apiBase = '';
let apiToken = '';

export function setupApiClient(ip, token) {
  // Assume IP is provided like "192.168.1.100:3186" or just "192.168.1.100"
  let formattedIp = ip;
  if (!formattedIp.startsWith('http')) {
    formattedIp = `http://${formattedIp}`;
  }
  if (!formattedIp.includes(':', 6)) { // if no port specified
    formattedIp = `${formattedIp}:3186`;
  }
  
  apiBase = `${formattedIp}/api`;
  apiToken = token;
}

export async function fetchApi(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (apiToken) {
    headers['x-api-key'] = apiToken;
  }

  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let errorMsg = `Server error: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.message || errorMsg;
    } catch {
      // Ignore json parse error
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
