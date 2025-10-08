import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

dotenv.config();

const CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

type Label = {
    name: string;
    color: string;
    description: string;
};

type Config = {
    'from-repo': string;
    'to-repos': string[];
};

async function authenticateWithDeviceFlow(): Promise<string> {
    const deviceResp = await axios.post(
        DEVICE_CODE_URL,
        new URLSearchParams({
            client_id: CLIENT_ID,
            scope: 'repo',
        }),
        {
            headers: { Accept: 'application/json' },
        }
    );

    const { device_code, user_code, verification_uri, interval } = deviceResp.data;

    console.log(`\n🔐 Open ${verification_uri} and enter the code: ${user_code}`);

    let accessToken = '';
    while (!accessToken) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));

        try {
            const tokenResp = await axios.post(
                TOKEN_URL,
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    device_code,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }),
                {
                    headers: { Accept: 'application/json' },
                }
            );

            if (tokenResp.data.access_token) {
                accessToken = tokenResp.data.access_token;
            } else if (tokenResp.data.error !== 'authorization_pending') {
                throw new Error(`Error during token request: ${tokenResp.data.error}`);
            }
        } catch (err: any) {
            console.error('❌ Authentication failed:', err.message);
            process.exit(1);
        }
    }

    console.log('✅ GitHub authentication successful.\n');
    return accessToken;
}

async function getRepoLabels(token: string, repo: string): Promise<Label[]> {
    const [owner, repoName] = repo.split('/');
    const response = await axios.get(
        `${API_BASE}/repos/${owner}/${repoName}/labels`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        }
    );

    return response.data.map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
    }));
}

async function canAccessRepoLabels(token: string, repo: string): Promise<boolean> {
    const [owner, repoName] = repo.split('/');
    try {
        await axios.get(`${API_BASE}/repos/${owner}/${repoName}/labels?per_page=1`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return true;
    } catch (err: any) {
        if (err.response?.status === 404) {
            return false;
        } else if (err.response?.status === 403) {
            console.warn(`⚠️  Access denied to repository "${repo}". You might lack permissions.`);
            return false;
        }
        throw err;
    }
}

async function upsertLabel(token: string, repo: string, label: Label) {
    const [owner, repoName] = repo.split('/');
    const url = `${API_BASE}/repos/${owner}/${repoName}/labels/${encodeURIComponent(label.name)}`;

    try {
        // Try to update the label
        await axios.patch(
            url,
            {
                new_name: label.name,
                color: label.color,
                description: label.description,
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            }
        );
        console.log(`🔁 Updated label: ${label.name} in ${repo}`);
    } catch (error: any) {
        if (error.response?.status === 404) {
            // Create new label if not found
            try {
                await axios.post(
                    `${API_BASE}/repos/${owner}/${repoName}/labels`,
                    {
                        name: label.name,
                        color: label.color,
                        description: label.description,
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Accept: 'application/vnd.github.v3+json',
                        },
                    }
                );
                console.log(`➕ Created label: ${label.name} in ${repo}`);
            } catch (postErr: any) {
                if (postErr.response?.status === 403) {
                    console.warn(`⚠️  Access denied when creating label "${label.name}" in "${repo}". Check your permissions.`);
                } else {
                    console.error(`❌ Failed to create label ${label.name} in ${repo}:`, postErr.message);
                }
            }
        } else if (error.response?.status === 403) {
            console.warn(`⚠️  Access denied when updating label "${label.name}" in "${repo}". Check your permissions.`);
        } else {
            console.error(`❌ Failed to sync label ${label.name} in ${repo}:`, error.message);
        }
    }
}

function coloredText(text: string, hexColor: string): string {
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function readConfig(): Config {
    const configPath = path.resolve(process.cwd(), 'config.yml');

    if (!fs.existsSync(configPath)) {
        console.error(`❌ config.yml file not found in the current directory (${process.cwd()})`);
        process.exit(1);
    }

    const fileContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContent) as Config;

    if (!config['from-repo'] || !Array.isArray(config['to-repos'])) {
        console.error('❌ Invalid config.yml format. Expected "from-repo" string and "to-repos" array.');
        process.exit(1);
    }

    return config;
}

async function main() {
    console.log('📦 Synchrophasotron (reading `config.yml` to sync your labels)\n');

    const token = await authenticateWithDeviceFlow();

    const config = readConfig();

    console.log(`Source repo: ${config['from-repo']}`);
    console.log(`Destination repos: ${config['to-repos'].join(', ')}\n`);

    const labels = await getRepoLabels(token, config['from-repo']);

    console.log(`🔍 Found ${labels.length} labels in ${config['from-repo']}:`);
    labels.forEach((label: Label) => {
        const colorPreview = coloredText('⬤', label.color);
        const desc = label.description || '(no description)';
        console.log(`- ${colorPreview} ${label.name}: ${desc}`);
    });

    console.log('\n🔄 Starting sync...\n');

    for (const destRepo of config['to-repos']) {
        const accessible = await canAccessRepoLabels(token, destRepo);
        if (!accessible) {
            console.warn(`⚠️  Repository "${destRepo}" is missing or inaccessible. Skipping.`);
            continue;
        }

        console.log(`➡️  Syncing to ${destRepo}...`);
        for (const label of labels) {
            await upsertLabel(token, destRepo, label);
        }
        console.log('');
    }

    console.log('✅ Label sync complete.');
}

main();
