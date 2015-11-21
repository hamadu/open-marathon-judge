var exec = require('child_process').exec;
var aws = require('aws-sdk');
var fs = require('fs');
var path = require('path');
var s3 = new aws.S3({ apiVersion: '2006-03-01' });
var sqs = new aws.SQS();
var lambda = new aws.Lambda();
var async = require('async');

exports.handler = function(event, context) {
    var params = {
      QueueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/002853820913/open-marathon-testcase',
      AttributeNames: [],
      MaxNumberOfMessages: 1,
      MessageAttributeNames: [],
      WaitTimeSeconds: 0
    };

    var ReceiptHandle = '';
    var remoteSolutionPath = '';
    var remoteGraderPath = '';

    async.waterfall([
        function pollMessage(next) {
            sqs.receiveMessage(params, function(err, data) {
            	if (err) {
            		next(err);
            	} else {
            		next(null, data);
            	}
            });
        },
        function downloadSolutionFile(data, next) {
            if (!data.Messages || data.Messages.length == 0) {
                next('err: no message in queue');
            } else {
                var messageId = data.Messages[0].MessageId;
                ReceiptHandle = data.Messages[0].ReceiptHandle;
                var body = JSON.parse(data.Messages[0].Body);

                remoteSolutionPath = body.MessageAttributes.solution.Value;
                remoteGraderPath = body.MessageAttributes.grader.Value;
                var seed = body.MessageAttributes.seed.Value;

                console.log('remoteSolutionPath', remoteSolutionPath);
                console.log('remoteGraderPath', remoteGraderPath);

                // remoteSolutionPath = 'codes/Solution.jar';
                // remoteGraderPath = 'grader/SmallPolygonsGrader.jar';

                s3.getObject({
                    Bucket: 'open-marathon',
                    Key: remoteSolutionPath
                }, function(err, data) {
                    if (err) {
                        next(err, 'downloadSolutionFile');
                    } else {
                    	next(null, data, remoteGraderPath, seed);
                    }
                });
            }
        },
        function downloadGraderFile(solution, remoteGraderPath, seed, next) {
            s3.getObject({
                Bucket: 'open-marathon',
                Key: remoteGraderPath
            }, function(err, data) {
                if (err) {
                    next(err, 'downloadGraderFile');
                } else {
                	next(null, solution, data, seed);
                }
            });
        },
        function saveBinaryToFile(solution, grader, seed, next) {
            fs.writeFileSync('/tmp/Solution.jar', solution.Body);
            fs.writeFileSync('/tmp/Grader.jar', grader.Body);
            next(null, '/tmp/Solution.jar', '/tmp/Grader.jar', seed);
        },
        function executeSolution(solutionPath, graderPath, seed, next) {
            var execCommand = '';
            if (remoteSolutionPath.indexOf('.jar') >= 0) {
              execCommand = 'java -jar #1'.replace('#1', solutionPath);
            } else {
              execCommand = 'chmod 700 #1; #1'.replace('#1', solutionPath).replace('#1', solutionPath);
            }
            var command = 'java -jar #1 "#2" #3'
                .replace('#1', graderPath)
                .replace('#2', execCommand)
                .replace('#3', seed);
            console.log('command:' + command)

            var theProcess = exec(command, function(err, stdout, stderr) {
              if (err) {
                next(err);
              } else {
                next(null, seed, stdout);
              }
            });
        },
        function uploadResult(seed, result, next) {
            var base = path.dirname(remoteSolutionPath);

            s3.putObject({
                Bucket: 'open-marathon',
                Key: base + '/result/#1.txt'.replace('#1', seed),
                Body: result
            }, next);
        },
        function deleteMessage(data, next) {
            sqs.deleteMessage({
                QueueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/002853820913/open-marathon-testcase',
                ReceiptHandle: ReceiptHandle
            }, function(err, data) {
                if (!err) {
                    next(null);
                }
            });
        }
    ], function(err) {
    	  if (err) {
            console.log(err);
        } else {
            // lambda.invoke({
            //     FunctionName: 'executeTestCases',
            //     InvocationType: 'Event'
            // }, function(err, data) {
            //     context.done(err, 'Process complete');
            // });
        }
    });
};
