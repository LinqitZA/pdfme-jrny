/**
 * Feature #340: Bull queue job survives server restart
 *
 * Tests that queued jobs persist in Redis and resume processing after server restart.
 */

const http = require('http');
const { execSync, spawn } = require('child_process');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function waitForServer(maxWait) {
  maxWait = maxWait || 30000;
  var start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      var res = await request('GET', '/api/pdfme/health');
      if (res.status === 200) return true;
    } catch (e) {
      // not ready
    }
    await sleep(1000);
  }
  throw new Error('Server did not start within ' + maxWait + 'ms');
}

function getServerPids() {
  try {
    // Only get LISTEN pids (server), not client connections
    var output = execSync('lsof -ti :3000 -sTCP:LISTEN 2>/dev/null').toString().trim();
    if (!output) {
      // Fallback: find ts-node process for our server
      output = execSync("pgrep -f 'ts-node.*nest-module/src/main.ts' 2>/dev/null").toString().trim();
    }
    return output ? output.split('\n').map(function(p) { return parseInt(p.trim()); }).filter(function(p) { return !isNaN(p); }) : [];
  } catch (e) {
    return [];
  }
}

function killServer() {
  var pids = getServerPids();
  for (var i = 0; i < pids.length; i++) {
    try { process.kill(pids[i], 'SIGTERM'); } catch (e) { /* ignore */ }
  }
  return pids.length > 0;
}

function startServer() {
  var child = spawn('npx', [
    'ts-node', '--project', 'nest-module/tsconfig.json', 'nest-module/src/main.ts'
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: '/home/linqadmin/repo/pdfme-jrny',
    env: Object.assign({}, process.env),
  });
  child.unref();
  return child;
}

function redisCmd(cmd) {
  try {
    return execSync('docker exec pdfme-redis redis-cli ' + cmd + ' 2>/dev/null').toString().trim();
  } catch (e) { return ''; }
}

async function run() {
  console.log('Feature #340: Bull queue job survives server restart\n');

  // Phase 1: Verify queue is operational
  console.log('Phase 1: Verify queue is operational');

  var drainRes = await request('POST', '/api/pdfme/queue/drain');
  assert(drainRes.body.drained === true, 'Queue drained successfully');

  var statsRes = await request('GET', '/api/pdfme/queue/stats');
  assert(statsRes.status === 200, 'Queue stats endpoint responds');

  // Phase 2: Submit a delayed job that will NOT process before restart
  console.log('\nPhase 2: Submit delayed job before restart');

  var delayMs = 120000;
  var jobRes = await request('POST', '/api/pdfme/queue/submit', {
    templateId: 'restart-test-tpl-340',
    entityId: 'restart-entity-340',
    entityType: 'restart-test',
    orgId: 'test-org-340',
    channel: 'print',
    triggeredBy: 'test-user-340',
    delay: delayMs,
  });

  assert(jobRes.body.queued === true, 'Delayed job submitted successfully');
  assert(!!jobRes.body.jobId, 'Job ID returned: ' + jobRes.body.jobId);
  var delayedJobId = jobRes.body.jobId;

  // Verify job is in delayed state
  await sleep(500);
  var preStatus = await request('GET', '/api/pdfme/queue/jobs/' + delayedJobId);
  assert(preStatus.status === 200, 'Job status retrievable before restart');
  assert(preStatus.body.state === 'delayed', 'Job is in delayed state: ' + preStatus.body.state);
  assert(preStatus.body.data.templateId === 'restart-test-tpl-340', 'Job data has correct templateId');
  assert(preStatus.body.data.entityId === 'restart-entity-340', 'Job data has correct entityId');
  assert(preStatus.body.data.triggeredBy === 'test-user-340', 'Job data has correct triggeredBy');
  assert(preStatus.body.data.orgId === 'test-org-340', 'Job data has correct orgId');
  assert(preStatus.body.data.channel === 'print', 'Job data has correct channel');

  // Also submit a completed job for cross-restart verification
  var immediateRes = await request('POST', '/api/pdfme/queue/submit', {
    templateId: 'baseline-tpl-340',
    entityId: 'baseline-entity-340',
    entityType: 'test',
    orgId: 'test-org',
    channel: 'print',
    triggeredBy: 'test-user-340',
  });
  var baselineJobId = immediateRes.body.jobId;
  await sleep(2000);
  var baselineStatus = await request('GET', '/api/pdfme/queue/jobs/' + baselineJobId);
  assert(baselineStatus.body.state === 'completed', 'Baseline job completed before restart');

  // Phase 3: Verify job is persisted in Redis
  console.log('\nPhase 3: Verify job persisted in Redis');

  var jobKey = 'bull:pdfme-render:' + delayedJobId;
  var exists = redisCmd('EXISTS ' + jobKey);
  assert(exists === '1', 'Job key exists in Redis: ' + jobKey);

  var jobDataRaw = redisCmd('HGET ' + jobKey + ' data');
  assert(jobDataRaw.includes('restart-test-tpl-340'), 'Redis contains templateId');
  assert(jobDataRaw.includes('restart-entity-340'), 'Redis contains entityId');

  var delayedCount = redisCmd('ZCARD bull:pdfme-render:delayed');
  assert(parseInt(delayedCount) >= 1, 'Delayed sorted set has entries: ' + delayedCount);

  // Phase 4: Kill server
  console.log('\nPhase 4: Kill server');

  var killed = killServer();
  assert(killed, 'Server process terminated');

  await sleep(4000);

  var serverDown = false;
  try {
    await request('GET', '/api/pdfme/health');
  } catch (e) {
    serverDown = true;
  }
  assert(serverDown, 'Server confirmed down');

  // Phase 5: Verify job persists in Redis while server is down
  console.log('\nPhase 5: Verify job persists in Redis while server is down');

  var stillExists = redisCmd('EXISTS ' + jobKey);
  assert(stillExists === '1', 'Job still exists in Redis after server stop');

  var stillData = redisCmd('HGET ' + jobKey + ' data');
  assert(stillData.includes('restart-test-tpl-340'), 'Job data intact: templateId');
  assert(stillData.includes('restart-entity-340'), 'Job data intact: entityId');
  assert(stillData.includes('test-user-340'), 'Job data intact: triggeredBy');

  var stillDelayed = redisCmd('ZCARD bull:pdfme-render:delayed');
  assert(parseInt(stillDelayed) >= 1, 'Delayed sorted set preserved: ' + stillDelayed);

  // Also check completed job persists
  var completedKey = 'bull:pdfme-render:' + baselineJobId;
  var completedExists = redisCmd('EXISTS ' + completedKey);
  assert(completedExists === '1', 'Completed job data also persists in Redis');

  // Phase 6: Start server back up
  console.log('\nPhase 6: Restart server');

  startServer();
  await waitForServer(45000);
  assert(true, 'Server restarted successfully');

  var healthRes = await request('GET', '/api/pdfme/health');
  assert(healthRes.status === 200, 'Server healthy after restart');

  // Phase 7: Verify jobs accessible after restart
  console.log('\nPhase 7: Verify jobs accessible after restart');

  var postDelayedStatus = await request('GET', '/api/pdfme/queue/jobs/' + delayedJobId);
  assert(postDelayedStatus.status === 200, 'Delayed job retrievable via API after restart');
  var validStates = ['delayed', 'waiting', 'active', 'completed'];
  assert(validStates.includes(postDelayedStatus.body.state), 'Delayed job in valid state: ' + postDelayedStatus.body.state);
  assert(postDelayedStatus.body.data.templateId === 'restart-test-tpl-340', 'Delayed job data intact: templateId');
  assert(postDelayedStatus.body.data.entityId === 'restart-entity-340', 'Delayed job data intact: entityId');
  assert(postDelayedStatus.body.data.orgId === 'test-org-340', 'Delayed job data intact: orgId');
  assert(postDelayedStatus.body.data.channel === 'print', 'Delayed job data intact: channel');

  var postBaselineStatus = await request('GET', '/api/pdfme/queue/jobs/' + baselineJobId);
  assert(postBaselineStatus.status === 200, 'Completed job retrievable after restart');
  assert(postBaselineStatus.body.state === 'completed', 'Completed job still completed: ' + postBaselineStatus.body.state);
  assert(postBaselineStatus.body.data.entityId === 'baseline-entity-340', 'Completed job data intact');

  // Phase 8: Verify worker processes new jobs after restart
  console.log('\nPhase 8: Verify worker processes jobs after restart');

  var newJobRes = await request('POST', '/api/pdfme/queue/submit', {
    templateId: 'post-restart-tpl',
    entityId: 'post-restart-entity-340',
    entityType: 'test',
    orgId: 'test-org',
    channel: 'print',
    triggeredBy: 'test-user-340',
  });
  assert(!!newJobRes.body.jobId, 'New job submitted after restart: ' + newJobRes.body.jobId);

  var waitRes = await request('GET', '/api/pdfme/queue/jobs/' + newJobRes.body.jobId + '/wait?timeout=15000');
  assert(waitRes.body.result && waitRes.body.result.status === 'done', 'New job completed successfully after restart');
  assert(waitRes.body.jobStatus && waitRes.body.jobStatus.state === 'completed', 'New job state is completed');

  // Phase 9: Queue infrastructure restored
  console.log('\nPhase 9: Queue infrastructure restored');

  var postStats = await request('GET', '/api/pdfme/queue/stats');
  assert(postStats.status === 200, 'Queue stats available after restart');
  assert(postStats.body.completed >= 1, 'Completed count >= 1: ' + postStats.body.completed);

  var metaExists = redisCmd('EXISTS bull:pdfme-render:meta');
  assert(metaExists === '1', 'Queue meta key persisted in Redis');

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests');

  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('Test error:', err.message);
  process.exit(1);
});
