import * as fs from 'node:fs/promises';

import * as core from '@actions/core';
import {Context as GithubContext} from '@actions/github/lib/context';
import {Util} from '@docker/actions-toolkit/lib/util';
import {Git} from '@docker/actions-toolkit/lib/git';
import {GitHub} from '@docker/actions-toolkit/lib/github';

export interface Context extends GithubContext {
  commitDate: Date;
}

export interface Inputs {
  context: ContextSource;
  images: string[];
  tags: string[];
  flavor: string[];
  labels: string[];
  annotations: string[];
  sepTags: string;
  sepLabels: string;
  sepAnnotations: string;
  bakeTarget: string;
  githubToken: string;
}

export function getInputs(): Inputs {
  return {
    context: (core.getInput('context') || ContextSource.workflow) as ContextSource,
    images: Util.getInputList('images', {ignoreComma: true, comment: '#'}),
    tags: Util.getInputList('tags', {ignoreComma: true, comment: '#'}),
    flavor: Util.getInputList('flavor', {ignoreComma: true, comment: '#'}),
    labels: Util.getInputList('labels', {ignoreComma: true, comment: '#'}),
    annotations: Util.getInputList('annotations', {ignoreComma: true, comment: '#'}),
    sepTags: core.getInput('sep-tags', {trimWhitespace: false}) || `\n`,
    sepLabels: core.getInput('sep-labels', {trimWhitespace: false}) || `\n`,
    sepAnnotations: core.getInput('sep-annotations', {trimWhitespace: false}) || `\n`,
    bakeTarget: core.getInput('bake-target') || `docker-metadata-action`,
    githubToken: core.getInput('github-token')
  };
}

export enum ContextSource {
  workflow = 'workflow',
  git = 'git'
}

export async function getContext(source: ContextSource): Promise<Context> {
  switch (source) {
    case ContextSource.workflow:
      return await getContextFromWorkflow();
    case ContextSource.git:
      return await getContextFromGit();
    default:
      throw new Error(`Invalid context source: ${source}`);
  }
}

async function getContextFromWorkflow(): Promise<Context> {
  const context = GitHub.context;

  // Needs to override Git reference with pr ref instead of upstream branch ref
  // for pull_request_target event
  // https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request_target
  if (/pull_request_target/.test(context.eventName)) {
    context.ref = `refs/pull/${context.payload.number}/merge`;
  }

  // DOCKER_METADATA_PR_HEAD_SHA env var can be used to set associated head
  // SHA instead of commit SHA that triggered the workflow on pull request
  // event.
  if (/true/i.test(process.env.DOCKER_METADATA_PR_HEAD_SHA || '')) {
    if ((/pull_request/.test(context.eventName) || /pull_request_target/.test(context.eventName)) && context.payload?.pull_request?.head?.sha != undefined) {
      context.sha = context.payload.pull_request.head.sha;
    }
  }

  return {
    commitDate: await getCommitDateFromWorkflow(),
    ...context
  } as Context;
}

async function getContextFromGit(): Promise<Context> {
  const ctx = await Git.context();

  return {
    commitDate: await Git.commitDate(ctx.sha),
    ...ctx
  } as Context;
}

async function getCommitDateFromWorkflow(): Promise<Date> {
  const eventFile = await fs.readFile(process.env.GITHUB_EVENT_PATH!, 'utf-8');

  console.log(eventFile);

  const event = JSON.stringify(eventFile) as unknown as {commits: Array<{timestamp: string}>};

  const commitDate = event.commits[0].timestamp;
  if (!commitDate) {
    throw new Error('failed to get commit date from event');
  }

  return new Date(commitDate);
}
