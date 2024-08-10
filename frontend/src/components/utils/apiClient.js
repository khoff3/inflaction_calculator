import axios from 'axios';

const apiClient = axios.create({
    headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Expires': '0'
    }
});

export default apiClient;
