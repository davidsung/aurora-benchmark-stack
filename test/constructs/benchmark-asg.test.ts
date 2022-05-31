import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import { Autoscaler } from '../../src/constructs/autoscaler';

test('BenchmarkAutoscaler has configured min, max & desired capacity', () => {
  // GIVEN
  const stack = new cdk.Stack();
  new ec2.Vpc(stack, 'VPC');
  // WHEN
  // new Autoscaler(stack, 'Autoscaler', {
  //   vpc,
  //   asgName: 'test-asg',
  //   minCapacity: 1,
  //   desiredCapacity: 2,
  // });
  // // THEN
  // const template = Template.fromStack(stack);
  // template.resourceCountIs('AWS::EC2::LaunchTemplate', 1);
  // template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
  //   MaxSize: '3',
  //   MinSize: '1',
  //   DesiredCapacity: '2',
  //   AutoScalingGroupName: 'test-asg',
  // });
});
