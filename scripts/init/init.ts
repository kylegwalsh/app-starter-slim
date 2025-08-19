import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { promptSelect, promptUser, promptYesNo } from '../utils/input.js';

// ---------- CLI HELPERS ----------
/** The CLIs we require to run the initialization script */
const CLI_REQUIREMENTS = [
  {
    name: 'pnpm',
    versionCmd: 'pnpm --version',
    url: 'https://pnpm.io/installation',
  },
  {
    name: 'gh',
    versionCmd: 'gh --version',
    url: 'https://github.com/cli/cli#installation',
  },
  {
    name: 'aws',
    versionCmd: 'aws --version',
    url: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  },
  {
    name: 'docker',
    versionCmd: 'docker --version',
    url: 'https://docs.docker.com/get-docker/',
  },
];

/** Check if the user is authenticated with GitHub CLI */
const checkGhAuth = () => {
  try {
    execSync('gh auth status');
  } catch {
    console.log("❌ GitHub CLI is not authenticated. Please run 'gh auth login' and try again.\n");
    process.exit(1);
  }
};

/** Check if required CLIs are installed */
export const checkCLIs = () => {
  console.log('Checking CLI tools...');

  // Check to ensure the user has all the CLI tools installed
  const missing: { name: string; url: string }[] = [];
  for (const cli of CLI_REQUIREMENTS) {
    try {
      execSync(cli.versionCmd);
    } catch {
      missing.push({ name: cli.name, url: cli.url });
    }
  }
  if (missing.length > 0) {
    console.log('Missing required CLI tools:');
    for (const m of missing) {
      console.log(`- ${m.name}: ${m.url}`);
    }
    console.log('\nPlease install the missing tools and try again.');
    process.exit(1);
  }

  // Check that the user is authenticated with gh
  checkGhAuth();

  console.log('✔ All CLI tools are installed\n');
};

// ---------- GIT HELPERS ----------
/** Get the user's current GitHub repo (if it exists) */
const getCurrentGitUrl = () => {
  try {
    return execSync('git remote get-url origin').toString().trim();
  } catch {
    return;
  }
};

/** Configure the GitHub Url for the repo */
const configureGithubUrl = async () => {
  // Keep looping until we get a valid URL
  while (true) {
    try {
      // Get the user's current repo
      const currentUrl = getCurrentGitUrl();
      if (currentUrl) {
        console.log(`Current GitHub repo: ${currentUrl}`);
      } else {
        console.log("No GitHub remote 'origin' is set.");
      }

      // Ask if they want to use a different repo
      const useDifferentRepo = await promptYesNo(
        'Would you like to use a different GitHub repo? (y/n) '
      );
      if (useDifferentRepo) {
        let newUrl = '';

        // Loop until they provide a valid URL
        while (!newUrl) {
          const input = await promptUser('Enter new GitHub repo URL: ');
          newUrl = input.trim();
          if (!newUrl) {
            console.log('Please enter a valid GitHub repo URL.');
          }
        }

        // If they had a url already, we'll update it
        if (currentUrl) {
          execSync(`git remote set-url origin ${newUrl}`);
        }
        // Otherwise, we'll add it as a new remote
        else {
          execSync(`git remote add origin ${newUrl}`);
        }

        // Check whether it's a valid repo
        execSync(`git ls-remote ${newUrl}`);

        console.log('✔ Updated repo\n');
        return newUrl;
      } else {
        console.log('✔ Using current repo\n');
        return currentUrl;
      }
    } catch {
      console.log(
        '❌ Unable to connect to the provided GitHub URL. Please verify the URL and try again.\n'
      );
    }
  }
};

/** Store secrets and environment variables in GitHub using the gh CLI */
const setupGithub = async ({
  awsConfig,
  dbConfig,
}: {
  awsConfig: Awaited<ReturnType<typeof selectOrCreateAwsProfile>>;
  dbConfig: Awaited<ReturnType<typeof setupSupabase>>;
}) => {
  console.log('Setting up GitHub...');

  // Configure the GitHub URL and extract the repo path
  const githubUrl = (await configureGithubUrl())!;
  const match = githubUrl.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  const repo = match ? match[1] : '';

  console.log(`Setting up GitHub environments and secrets...`);

  // Create environments (idempotent)
  execSync(
    `gh api --method PUT -H "Accept: application/vnd.github+json" repos/${repo}/environments/dev`
  );
  execSync(
    `gh api --method PUT -H "Accept: application/vnd.github+json" repos/${repo}/environments/prod`
  );

  // Set AWS secrets
  execSync(`gh secret set AWS_ACCESS_KEY_ID -a actions -b "${awsConfig.ci.awsAccessKey}"`);
  execSync(`gh secret set AWS_SECRET_ACCESS_KEY -a actions -b "${awsConfig.ci.awsSecretKey}"`);

  // Set sst stage (for each environment)
  execSync(`gh variable set SST_STAGE -b "dev" -e dev`);
  execSync(`gh variable set SST_STAGE -b "prod" -e prod`);

  // Set database secrets (for each environment)
  execSync(`gh secret set DATABASE_URL -a actions -b "${dbConfig.prod.dbUrl}" -e prod`);
  execSync(`gh secret set DIRECT_DATABASE_URL -a actions -b "${dbConfig.prod.directUrl}" -e prod`);
  execSync(`gh secret set DATABASE_URL -a actions -b "${dbConfig.dev.dbUrl}" -e dev`);
  execSync(`gh secret set DIRECT_DATABASE_URL -a actions -b "${dbConfig.dev.directUrl}" -e dev`);

  console.log('✔ GitHub environments and secrets have been set up.\n');

  return githubUrl;
};

// ---------- PROJECT DETAIL HELPERS ----------
/** Prompt for and update the project name if still default */
const getProjectName = async () => {
  console.log('Checking for the project name...');
  // Check for the app name in the config file
  const configPath = path.resolve('packages/config/config.ts');
  let configContent = fs.readFileSync(configPath, 'utf8');
  const appNameMatch = configContent.match(/app:\s*{[^}]*name:\s*['"][^'"]*['"]/s);
  let appName = appNameMatch ? appNameMatch[1] : undefined;

  // If the app name doesn't exist, we'll prompt the user for a new one
  if (!appName || appName === 'My App') {
    // Get a new name
    let newName = '';
    while (!newName) {
      const input = await promptUser(
        "Enter a name for your project (Title Case, e.g. 'My Project'): "
      );
      newName = input.trim();
      if (!/^([A-Z][a-z]+)( [A-Z][a-z]+)*$/.test(newName)) {
        console.log(
          "Please use Title Case (e.g. 'My Project'). Each word should start with a capital letter."
        );
        newName = '';
      }
    }

    // Write Title Case to config.ts
    configContent = configContent.replace(
      /app:\s*{([^}]*)name:\s*(['"])[^'"]*\2/s,
      (m, g1, quote) => `app: {${g1}name: ${quote}${newName}${quote}`
    );
    fs.writeFileSync(configPath, configContent);

    // Convert to kebab-case for other config files
    const kebabName = newName.replaceAll(' ', '-').toLowerCase();

    // Update sst.config.ts, always use single quotes
    const sstConfigPath = path.resolve('sst.config.ts');
    let sstConfig = fs.readFileSync(sstConfigPath, 'utf8');
    sstConfig = sstConfig.replace(/name:\s*['"][^'"]*['"]/, `name: '${kebabName}'`);
    fs.writeFileSync(sstConfigPath, sstConfig);

    // Update package.json
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = kebabName;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, undefined, 2) + '\n');
    appName = newName;

    console.log(`✔ Project name updated to: ${newName}\n`);
  } else {
    console.log(`✔ Project name already configured: ${appName}\n`);
  }
  return appName;
};

/** Prompt for and update the website domain if still default */
export const getDomain = async () => {
  console.log('Checking for the website domain...');
  const constantsPath = path.resolve('infra/constants.ts');
  let constantsContent = fs.readFileSync(constantsPath, 'utf8');

  // Regex to match: const baseDomain = ...;
  const baseDomainRegex = /const\s+baseDomain(?:\s*:\s*string)?\s*=\s*(['"])([^'\"]*)\1/;
  const match = constantsContent.match(baseDomainRegex);

  // If we don't find a match, we are missing something important in the constants file
  if (!match) {
    console.log('❌ Could not find the baseDomain assignment in infra/constants.ts.');
    process.exit(1);
  }

  // Extract the value from the match
  const currentValue = match[2];

  // If baseDomain is set, we'll use that
  if (currentValue) {
    console.log(`✔ Web domain already configured: ${currentValue}\n`);
    return currentValue;
  }
  // If we don't find a value, we'll prompt the user for a custom domain
  else {
    const wantsCustomDomain = await promptYesNo(
      'Would you like to use a custom domain for your app? (y/n) '
    );

    if (!wantsCustomDomain) {
      console.log('Custom domain setup skipped.\n');
      return;
    }

    let baseDomain = '';
    while (!baseDomain) {
      const input = await promptUser('Enter your base domain (e.g., example.com): ');
      const trimmed = input.trim().toLowerCase();
      // Validate: must be a valid domain, no protocol, no subdomain, no trailing dot
      if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(trimmed)) {
        console.log(
          '\n❌ Please enter a valid domain (e.g., example.com). Do not include subdomains or protocols (e.g., https://).'
        );
        continue;
      }
      baseDomain = trimmed;
    }

    // Replace only the empty string at the end of the baseDomain line
    constantsContent = constantsContent.replace(
      baseDomainRegex,
      `const baseDomain: string = '${baseDomain}'`
    );
    fs.writeFileSync(constantsPath, constantsContent);
    console.log(`✔ Web base domain set to: ${baseDomain}\n`);
    return baseDomain;
  }
};

/** Get or create the user's personal environment stage */
export const getOrCreateStage = async () => {
  console.log("Checking for the user's personal environment stage...");

  // Check if the user has a .sst/stage file
  const stagePath = path.resolve('.sst/stage');

  // Create .sst directory if it doesn't exist
  const sstDir = path.dirname(stagePath);
  if (!fs.existsSync(sstDir)) {
    fs.mkdirSync(sstDir, { recursive: true });
  }

  if (fs.existsSync(stagePath)) {
    const stage = fs.readFileSync(stagePath, 'utf8').trim();

    // If we locate the stage value, we'll use that and skip this step
    if (stage) {
      console.log(`✔ Using existing stage '${stage}'!\n`);
      return stage;
    }
  }

  // If we don't find a stage, we'll prompt the user to enter one
  let stage = '';
  while (!stage) {
    const input = await promptUser("Enter a name for your personal environment (e.g. 'kwalsh'): ");
    stage = input.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(stage)) {
      console.log(
        'Please use only letters, numbers, dashes, or underscores for the environment name.'
      );
      stage = '';
    }
  }

  // Write the final result to the .sst/stage file
  fs.writeFileSync(stagePath, stage + '\n');
  console.log(`✔ Created .sst/stage with value '${stage}'!\n`);
  return stage;
};

/**
 * Parse the output from 'pnpm sst secret list' and extract all secrets
 * @param output The stdout from the secret list command
 * @returns Object containing all secrets as key-value pairs
 */
const getAllSecrets = (stage: string) => {
  const result: Record<string, string> = {};
  const output = execSync(`pnpm sst secret list --stage ${stage}`).toString();

  /** Extract all the lines from the output */
  const lines = output.split('\n');

  /** Track whether we're reading the fallback section's variables */
  let inFallbackSection = false;
  /** Whether we're in the dev stage */
  const isDevStage = stage === 'dev';

  for (const line of lines) {
    // Check for section headers
    if (line.startsWith('#')) {
      inFallbackSection = line.trim() === '# fallback';
      continue;
    }

    // Skip empty lines
    if (!line.trim()) continue;
    // For dev stage: only use fallback values
    if (isDevStage && !inFallbackSection) continue;
    // For other stages: skip fallback values and use stage-specific values
    if (!isDevStage && inFallbackSection) continue;

    // Look for lines that contain secret key-value pairs
    // Based on the format: "SECRET_NAME=secret_value"
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) {
      const [, key, value] = match;
      result[key] = value.trim();
    }
  }

  return result;
};

/** Script for adding secrets to SST */
const addSecretScript = path.resolve('apps/backend/scripts/add-secret.ts');
/** SST secrets for dev environment */
let devSecrets: Record<string, string> = {};
/** SST secrets for prod environment */
let prodSecrets: Record<string, string> = {};

/** Initialize both our global secret variables */
const initSecrets = () => {
  try {
    devSecrets = getAllSecrets('dev');
    prodSecrets = getAllSecrets('prod');
  } catch {}
};

// ---------- AWS HELPERS ----------
/**
 * Prompt the user to select an AWS profile or create a new one.
 * Updates ~/.aws/credentials, ~/.aws/config, and .vscode/settings.json as needed.
 * Returns the selected profile name and credentials for personal and CI.
 */
export const selectOrCreateAwsProfile = async () => {
  console.log('Setting up AWS profile...');

  const homedir = os.homedir();
  const credPath = path.join(homedir, '.aws/credentials');
  const configPath = path.join(homedir, '.aws/config');
  const vscodeSettingsPath = path.resolve('.vscode/settings.json');

  // ---------- PERSONAL CREDENTIALS ----------
  // Read existing profiles
  let profiles: string[] = [];
  if (fs.existsSync(credPath)) {
    const credContent = fs.readFileSync(credPath, 'utf8');
    profiles = [...credContent.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
  }

  const choices = [...profiles, 'Create new profile...'];
  const selected = await promptSelect('Which AWS profile would you like to use?', choices);

  let profile = selected;
  let accessKey = '';
  let secretKey = '';
  if (selected === 'Create new profile...') {
    // Prompt for new profile details
    while (true) {
      const profileInput = await promptUser('Enter a name for the new AWS profile: ');
      profile = profileInput.trim();
      if (!profile) {
        console.log('Profile name cannot be empty.');
        continue;
      }
      if (profiles.includes(profile)) {
        console.log('Profile already exists. Please choose a different name.');
        continue;
      }
      break;
    }

    // Get the user's AWS details
    while (!accessKey) {
      const accessKeyInput = await promptUser('Enter AWS Access Key ID: ');
      accessKey = accessKeyInput.trim();
      if (!accessKey) {
        console.log('AWS Access Key ID cannot be empty.');
      }
    }

    while (!secretKey) {
      const secretKeyInput = await promptUser('Enter AWS Secret Access Key: ');
      secretKey = secretKeyInput.trim();
      if (!secretKey) {
        console.log('AWS Secret Access Key cannot be empty.');
      }
    }

    const regionInput = await promptUser(
      'Enter AWS Region (press enter for default of us-east-1): '
    );
    const region = regionInput.trim() || 'us-east-1';

    // Append to credentials file
    const credEntry = `\n[${profile}]\naws_access_key_id=${accessKey}\naws_secret_access_key=${secretKey}\nregion=${region}\n`;
    fs.appendFileSync(credPath, credEntry);

    // Append to config file
    const configEntry = `\n[profile ${profile}]\nregion = ${region}\n`;
    fs.appendFileSync(configPath, configEntry);

    console.log(`✔ Created new AWS profile: ${profile}`);
  } else {
    // If selecting an existing profile, try to read the keys from the credentials file
    if (fs.existsSync(credPath)) {
      const credContent = fs.readFileSync(credPath, 'utf8');
      const profileRegex = new RegExp(`\\[${profile}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'g');
      const match = profileRegex.exec(credContent);
      if (match && match[1]) {
        const sectionContent = match[1];
        const keyMatch = sectionContent.match(/aws_access_key_id\s*=\s*([^\n]+)/);
        const secretMatch = sectionContent.match(/aws_secret_access_key\s*=\s*([^\n]+)/);
        accessKey = keyMatch ? keyMatch[1].trim() : '';
        secretKey = secretMatch ? secretMatch[1].trim() : '';
      }
    }
  }

  // If we don't have any keys at this point, we'll just fail out
  if (!accessKey || !secretKey) process.exit(1);

  // Update .vscode/settings.json
  if (fs.existsSync(vscodeSettingsPath)) {
    let settings = fs.readFileSync(vscodeSettingsPath, 'utf8');
    settings = settings.replaceAll(
      /(['"]AWS_PROFILE['"]\s*:\s*['"])[^'"]*(['"])/g,
      `$1${profile}$2`
    );
    fs.writeFileSync(vscodeSettingsPath, settings);
    console.log(`✔ Updated .vscode/settings.json to use AWS profile: ${profile}\n`);
  }

  // Run aws configure to set the current active profile (helpful for the rest of this run)
  try {
    execSync(`aws configure set profile ${profile}`);
  } catch {}

  // ---------- CI CREDENTIALS ----------
  // Ask if they want to use the same credentials for Github Actions CI
  const useSameForCI = await promptYesNo(
    'Would you like to use the same AWS credentials for your Github Actions CI deployments? (y/n) '
  );

  let ciAccessKey = '';
  let ciSecretKey = '';
  if (useSameForCI) {
    ciAccessKey = accessKey;
    ciSecretKey = secretKey;
  } else {
    // Prompt for CI credentials
    while (!ciAccessKey) {
      const ciAccessKeyInput = await promptUser('Enter AWS Access Key ID for CI: ');
      ciAccessKey = ciAccessKeyInput.trim();
      if (!ciAccessKey) {
        console.log('AWS Access Key ID for CI cannot be empty.');
      }
    }
    while (!ciSecretKey) {
      const ciSecretKeyInput = await promptUser('Enter AWS Secret Access Key for CI: ');
      ciSecretKey = ciSecretKeyInput.trim();
      if (!ciSecretKey) {
        console.log('AWS Secret Access Key for CI cannot be empty.');
      }
    }
  }

  console.log('✔ Configured AWS credentials for CI.\n');

  return {
    personal: {
      awsProfile: profile,
      awsAccessKey: accessKey,
      awsSecretKey: secretKey,
    },
    ci: {
      awsProfile: 'ci',
      awsAccessKey: ciAccessKey,
      awsSecretKey: ciSecretKey,
    },
  };
};

// ---------- SUPABASE HELPERS ----------
/** Generate the URLs for the Supabase database using a template URL and password */
const generateSupabaseUrls = (baseUrl: string, password: string) => {
  // Replace the password in the base URL (between the last ':' before @ and the @)
  const urlWithPassword = baseUrl.replace(/:(?:[^:@]+)@/, `:${password}@`);
  // For DATABASE_URL: port 6543, add ?pgbouncer=true
  const dbUrl =
    urlWithPassword.replace(/:(\d+)(\/postgres)/, ':6543$2').replace(/\?.*$/, '') +
    '?pgbouncer=true';
  // For DIRECT_DATABASE_URL: port 5432, no query string
  const directUrl = urlWithPassword.replace(/:(\d+)(\/postgres)/, ':5432$2').replace(/\?.*$/, '');
  return { directUrl, dbUrl };
};

/**
 * Prompt the user for a Supabase Transaction pooler URL and validate its format.
 * Keeps prompting until a valid URL is entered.
 */
const promptValidSupabaseUrl = async (promptMsg: string): Promise<string> => {
  while (true) {
    const input = await promptUser(promptMsg);
    const url = input.trim();
    if (/^postgresql:\/\/.+@.+\/postgres$/.test(url) && /aws/i.test(url)) {
      return url;
    }
    console.log(
      "Please enter a valid Supabase Transaction pooler URL (must start with 'postgresql://', contain '@', mention 'aws', and end with '/postgres')."
    );
  }
};

/**
 * Guides the user through setting up Supabase, generates DATABASE_URL and DIRECT_DATABASE_URL for dev and prod,
 * and calls the add-secret script to store them.
 */
const setupSupabase = async (projectName: string) => {
  console.log('Setting up Supabase...');

  const databaseConfig = {
    prod: {
      dbUrl: '',
      directUrl: '',
    },
    dev: {
      dbUrl: '',
      directUrl: '',
    },
  };

  // If the secrets haven't been setup yet, let's try to init them
  if (Object.keys(devSecrets).length === 0) initSecrets();

  // Check if Supabase is already configured
  let alreadyConfigured = false;
  // Extract database URLs from the parsed secrets
  databaseConfig.dev = {
    dbUrl: devSecrets.DATABASE_URL || '',
    directUrl: devSecrets.DIRECT_DATABASE_URL || '',
  };
  databaseConfig.prod = {
    dbUrl: prodSecrets.DATABASE_URL || '',
    directUrl: prodSecrets.DIRECT_DATABASE_URL || '',
  };

  // Check if both dev and prod have all their secrets configured
  if (
    databaseConfig.dev.dbUrl &&
    databaseConfig.prod.dbUrl &&
    databaseConfig.dev.directUrl &&
    databaseConfig.prod.directUrl
  ) {
    alreadyConfigured = true;
  }

  // See what the user would like to do if it's already setup
  if (alreadyConfigured) {
    const shouldUpdate = await promptYesNo(
      'It looks like Supabase is already configured. Would you like to update the Supabase connection? (y/n) '
    );
    if (!shouldUpdate) {
      console.log('Skipping Supabase setup.\n');
      return databaseConfig;
    }
  }

  console.log('Sign up or log in to Supabase: https://supabase.com/dashboard/organizations');
  console.log(
    'You can have 2 free databases (dev/prod) per account. You may want to create a fresh account per project.'
  );
  await promptUser('Press enter to continue...');

  // --- Production ---
  console.log(`\nCreate a production project in Supabase (e.g. '${projectName}')`);
  const prodPassword = await promptUser(
    'Enter the password you set for your production database: '
  );
  const prodBaseUrl = await promptValidSupabaseUrl(
    "After your project is created, click 'Connect' and copy the 'Transaction pooler' URL (starts with postgresql://...): "
  );

  // --- Development ---
  console.log(`\nCreate a dev project in Supabase (e.g. '${projectName} (dev)')`);
  const devPassword = await promptUser('Enter the password you set for your dev database: ');
  const devBaseUrl = await promptValidSupabaseUrl(
    "After your project is created, click 'Connect' and copy the 'Transaction pooler' URL (starts with postgresql://...): "
  );

  const prodUrls = generateSupabaseUrls(prodBaseUrl, prodPassword);
  const devUrls = generateSupabaseUrls(devBaseUrl, devPassword);

  // --- Call add-secret script for each secret ---
  console.log('\nAdding Supabase secrets to SST...');
  // For prod
  execSync(
    `pnpm tsx ${addSecretScript} DIRECT_DATABASE_URL "${devUrls.directUrl}" "${prodUrls.directUrl}"`
  );
  execSync(`pnpm tsx ${addSecretScript} DATABASE_URL "${devUrls.dbUrl}" "${prodUrls.dbUrl}"`);
  console.log('✔ Supabase secrets have been set in SST.\n');

  // Update the config object with the new values
  databaseConfig.prod = prodUrls;
  databaseConfig.dev = devUrls;

  return databaseConfig;
};

// ---------- BETTER AUTH HELPERS ----------
/** Guides the user through setting up Better Auth */
const setupBetterAuth = () => {
  console.log('Setting up Better Auth...');

  // If the secrets haven't been setup yet, let's try to init them
  if (Object.keys(devSecrets).length === 0) initSecrets();

  // Check if BETTER_AUTH_SECRET is already configured in SST secrets
  if (devSecrets.BETTER_AUTH_SECRET && prodSecrets.BETTER_AUTH_SECRET) {
    console.log('✔ Better Auth secret already configured.\n');
    return true;
  }

  // Generate a random 32-character string
  const randomString = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join('');

  // Add secret to SST
  console.log('Adding Better Auth secret to SST...');
  execSync(`pnpm tsx ${addSecretScript} BETTER_AUTH_SECRET "${randomString}" "${randomString}"`);
  console.log('✔ Better Auth secret has been set in SST.\n');

  return true;
};

// ---------- AI SETUP HELPER ----------
/** Guides the user through setting up AI */
const setupAI = async () => {
  console.log('Setting up AI...');

  // Ask if they want to set up AI
  const doSetup = await promptYesNo('Would you like to set up AI (AWS Bedrock)? (y/n) ');
  if (!doSetup) {
    console.log('AI setup skipped.\n');
    return false;
  }

  // Guide the user through the setup steps
  console.log('\nTo enable AI models in AWS Bedrock:');
  console.log(
    '1. Go to https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess'
  );
  console.log('2. Request access to at least the Anthropic models.');
  await promptUser('Press enter to continue after you have requested model access...');
  console.log('✔ AI setup step complete.\n');
  return true;
};

// ---------- NOTES HELPERs ----------
/** Prints tips and disclosures for the user. */
const printTips = async () => {
  console.log('--- Tips and Disclosures ---');
  console.log(
    '- This script works best if you already have a domain purchased and managed by AWS Route 53.\n'
  );
  await promptUser('Press enter to continue...\n');
};

/** Prints final setup instructions and tips for the user. */
const printFinalNotes = () => {
  console.log('--- Final Steps ---');
  console.log('You can start the app with: pnpm dev\n');

  console.log(
    '- Make sure you restart your terminal for your AWS profile changes to take effect.\n'
  );
  console.log('✔ Setup complete! Happy coding!\n');
};

// ---------- MAIN ----------
/** Initializes everything we need to get started with this repo */
const init = async () => {
  console.log('Setting up starter...\n');

  // Check that all CLI tools are setup
  checkCLIs();

  // Mention some tips and disclosures
  await printTips();

  // Get and possibly update the project name
  const projectName = await getProjectName();

  // Get and possibly update the web url
  const domain = await getDomain();

  // Get or create the user's personal environment stage
  await getOrCreateStage();

  // Select or create an AWS profile
  const awsConfig = await selectOrCreateAwsProfile();

  // Setup Supabase
  const dbConfig = await setupSupabase(projectName);

  // Setup Better Auth
  setupBetterAuth();

  // Configure github url and secrets
  await setupGithub({
    awsConfig,
    dbConfig,
  });

  // Setup AI
  await setupAI();

  // Print final notes
  printFinalNotes();
};

// Only run init if this file is executed directly (not imported)
const currentFile = fileURLToPath(import.meta.url).replace(/\.ts$/, '');
const executedFile = process.argv[1].replace(/\.ts$/, '');
if (currentFile === executedFile) {
  void init();
}
