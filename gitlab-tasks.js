#!/usr/bin/env node
"use strict";
require('dotenv');

const {Gitlab} = require('@gitbeaker/node');
const prompts = require('prompts');
const Conf = require('conf');
const chalk = require('chalk');

const EventEmitter = require('events');
const appEmitter = new EventEmitter();

const config = new Conf();
prompts.override(require('yargs').argv);
const onCancel = async prompt => {
    process.exit(0);
}


const api = new Gitlab({
    host: process.env.GITLAB_HOST,
    token: process.env.GITLAB_TOKEN
});

let project = config.get('project');
let issue = config.get('issue');
let iteration = config.get('iteration');

(async () => {
    await main(api, project, issue);

})();

async function main(api, project, issue) {
    if (!project) await selectProject(api);
    if (!issue) await selectIssue(api, project);
    await taskOperations(api, project, issue);
}

appEmitter.on('selectIssue', async function (api, project) {
    console.log('Select a issue');
    selectIssue(api, project);
});

async function selectIssue(api, project) {
    if (!project) return;
    const issues = (await api.Issues.all({projectId: project.id}))
        .map(p => {
            return {value: p, title: p.iid + ' - ' + p.title}
        });
    if (!issues.length) {
        console.log('Project without tasks');
        appEmitter.emit('selectProject', api);
        return;
    }

    issue = (await prompts([
        {
            type: 'autocomplete',
            name: 'issue',
            message: 'Select your issue',
            choices: issues,
        }
    ], {onCancel})).issue;
    await printIssue(issue);
    config.set('issue', issue);
    appEmitter.emit('showTaskOperations', api, project, issue);
}

appEmitter.on('showTaskOperations', function (api, project, issue) {
    taskOperations(api, project, issue);
})

async function taskOperations(api, project, issue) {
    if (!project || !issue) return;
    console.log(`${project.path} >> ${issue.iid} - ${issue.title}`);
    const message = !!iteration ? `Actions [${iteration}]` : 'Actions';
    const response = await prompts([
        {
            type: 'select',
            name: 'task',
            message,
            choices: [{value: 1, title: 'Show task'},
                {value: 2, title: 'Change task'},
                {value: 3, title: 'Clone task'},
                {value: 5, title: 'Select project'},
                {value: 7, title: 'Change iteration'},
                {value: 6, title: 'Exit'}
            ]
        }
    ], {onCancel})
    switch (response.task) {
        case 1:
            await printIssue(issue);
            appEmitter.emit('showTaskOperations', api, project, issue);
            break;
        case 2:
            appEmitter.emit('selectIssue', api, project);
            break;
        case 3:
            appEmitter.emit('cloneIssue', api, project, issue);
            break;
        case 4:
            break;
        case 5:
            config.delete('issue');
            config.delete('project');
            project = null;
            issue = null;
            appEmitter.emit('selectProject', api);
            break;
        case 6:
            process.exit(0);
            break;
        case 7:
            appEmitter.emit('changeIteration', api);
            break;
    }
}

appEmitter.on('changeIteration', function (api) {
    changeIteration(api);
});

async function changeIteration(api) {
    const _iteration = (await prompts([
        {
            type: 'text',
            name: 'iteration',
            message: 'Iteration name',
        }
    ])).iteration;
    if (!_iteration) return;
    config.set('iteration', _iteration);
    iteration = _iteration;
    appEmitter.emit('selectProject', api);
}


appEmitter.on('selectProject', function (api) {
    selectProject(api);
});

async function selectProject(api) {
    //config.delete('project');
    //config.delete('issue');
    const projects = await api.Projects.all();
    const _projects = projects.map(p => {
        return {value: p, title: p.path}
    });
    project = (await prompts([
        {
            type: 'select',
            name: 'project',
            message: 'Select your project',
            choices: _projects,
        }
    ], {onCancel})).project;
    if (!project) return;
    config.set('project', project);
    appEmitter.emit('selectIssue', api, project);
}

appEmitter.on('cloneIssue', function (api, project, issue) {
    cloneIssue(api, project, issue);
});

async function cloneIssue(api, project, issue) {
    const title = (await prompts([
        {
            type: 'text',
            name: 'title',
            message: 'Add issue title',
        }
    ])).title;
    if (!title) return;
    console.log(title);
    const clonedIssue = await api.Issues.create(
        project.id,
        {
            title,
            labels: issue.labels
        }
    );
    if (!!issue.epic) {
        const epic =
            await api.Epics.show(issue.epic.group_id, issue.epic_iid);
        //console.log(clonedIssue);
        try {
            // console.log(epic)
            console.log(epic.references.full);
            await api.IssueDiscussions
                .create(project.id, clonedIssue.iid,
                    `/epic ${epic.references.full}`);

        } catch (e) {
            // bug api note can't
            // known bug https://gitlab.com/gitlab-org/gitlab/-/issues/16721
            //console.log(e);
        }

        try {
            await api.IssueDiscussions
                .create(project.id, clonedIssue.iid,
                    `/iteration *iteration:\"${iteration}\"`);
        } catch (e) {
            // bug api note can't
            // known bug https://gitlab.com/gitlab-org/gitlab/-/issues/16721
            //console.log(e);
        }
        // /iteration *iteration:"S2 Dev Start FE-BE"
    }

    appEmitter.emit('showTaskOperations', api, project, clonedIssue);

}

async function printIssue(issue) {
    console.clear();
    console.log(`${chalk.blue('id')}: ${issue.iid} title: ${issue.title}`);
    console.log(`URL: ${issue.web_url}`);
    console.log(`labels: ${issue.labels}`);
    if (!!issue.epic) {
        const epic = await api.Epics.show(issue.epic.group_id, issue.epic_iid);
        console.log(epic.references.full);
        // const epic = api.Epics.show(groupId, epicId)
        console.log(`Epic: ${issue.epic.title}`);
    }
}

