#!/usr/bin/env node

import 'dotenv/config';
import { createCli } from './cli.js';

createCli().parse();
