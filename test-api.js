// 測試 Render API 是否正常運作
const https = require('https');

const testEndpoints = [
    { name: 'Root', path: '/' },
    { name: 'Login (POST)', path: '/api/auth/login', method: 'POST', data: { username: 'test', password: 'test' } }
];

async function testAPI(baseURL) {
    console.log(`\n🔍 測試 API: ${baseURL}\n`);
    
    for (const endpoint of testEndpoints) {
        try {
            const url = new URL(endpoint.path, baseURL);
            const options = {
                method: endpoint.method || 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const result = await new Promise((resolve, reject) => {
                const req = https.request(url, options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body: data
                        });
                    });
                });

                req.on('error', reject);
                
                if (endpoint.data) {
                    req.write(JSON.stringify(endpoint.data));
                }
                
                req.end();
            });

            console.log(`✅ ${endpoint.name}: ${result.status}`);
            if (result.status >= 400) {
                console.log(`   Response: ${result.body.substring(0, 200)}`);
            }
        } catch (error) {
            console.log(`❌ ${endpoint.name}: ${error.message}`);
        }
    }
}

testAPI('https://moztech-wms-api.onrender.com');
