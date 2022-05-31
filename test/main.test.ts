import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BenchmarkDbStack } from '../src/main';

test('Snapshot', () => {
  const app = new App();
  const stack = new BenchmarkDbStack(app, 'test', {});

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

test('VPC Name and CIDR', () => {
  // GIVEN
  const app = new App();
  // WHEN
  const stack = new BenchmarkDbStack(app, 'test', {
    vpcName: 'test',
    vpcCidr: '172.31.0.0/16',
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '172.31.0.0/16',
    Tags: [
      {
        Key: 'Name',
        Value: 'test',
      },
    ],
  });
});

// test('Stack has LogGroup and configured LogGroupName', () => {
//   // GIVEN
//   const app = new App();
//   // WHEN
//   const stack = new BenchmarkDbStack(app, 'test', {
//     benchmarkLogGroupName: 'test',
//   });
//   // THEN
//   const template = Template.fromStack(stack);
//   template.hasResourceProperties('AWS::Logs::LogGroup', {
//     LogGroupName: 'test',
//   });
// });
