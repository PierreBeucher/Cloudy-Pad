import { CloudVMBoxManager } from "../common/cloud-virtual-machine.js";
import { AwsClient } from "../../lib/infra/aws/client.js";
import { z } from "zod";
import { BoxSchemaBaseZ as BoxSchemaBase, BoxMetadata } from "../common/base.js";
import { PulumiBoxManager } from "../pulumi/box-manager.js";
import { CompositeEC2Instance } from "../../lib/infra/pulumi/components/aws/composite-ec2.js";
import * as pulumi from "@pulumi/pulumi"
import { pulumiOutputMapToPlainObject } from "../../lib/infra/pulumi/pulumi-client.js";
import { OutputMap } from "@pulumi/pulumi/automation/stack.js";
import { DnsSchema, InstanceSchema, NetworkSchema, TagsSchema, VolumeSchema } from "./common.js";

export const CompositeEC2InstanceBoxManagerArgsZ = z.object({
    publicKey: z.string(),
    awsConfig: z.object({ // TODO need a better way to handle that
        region: z.string()
    }),
    instance: InstanceSchema,
    volumes: z.array(VolumeSchema).optional(),
    dns: DnsSchema.optional(),
    network: NetworkSchema.optional(),
    tags: TagsSchema.optional(),
});

/**
 * Matches CompositeEC2InstanceArgs
 */
export const CompositeEC2InstanceBoxSchema = BoxSchemaBase.extend({
    spec: CompositeEC2InstanceBoxManagerArgsZ,
})

/**
 * Outputs from Pulumi stack
 */
export const CompositeEC2InstanceOutputsZ = z.object({
    ipAddress: z.string(),
    instanceId: z.string(),
    fqdn: z.string().optional()
})


export type CompositeEC2InstanceOutputs = z.infer<typeof CompositeEC2InstanceOutputsZ>
export type EC2InstanceBoxManagerArgs = z.infer<typeof CompositeEC2InstanceBoxManagerArgsZ>

export const BOX_KIND_COMPOSITE_EC2_INSTANCE = "aws.ec2.CompositeInstance"

export class CompositeEC2BoxManager extends PulumiBoxManager<CompositeEC2InstanceOutputs> implements CloudVMBoxManager {
    
    static async parseSpec(source: unknown) : Promise<CompositeEC2BoxManager> {
        const config = CompositeEC2InstanceBoxSchema.parse(source)
        return new CompositeEC2BoxManager(config.name, config.spec)
    }

    readonly awsClient: AwsClient

    constructor(name: string, spec: EC2InstanceBoxManagerArgs) {

        // The Pulumi program returning box outputs
        const pulumiFn = async ()  => {
            const instance = new CompositeEC2Instance(name, spec)
    
            return pulumi.all([
                instance.instanceVolumesEIP.publicIp, 
                instance.instanceVolumesEIP.instance.id
            ]).apply( ([ip, instanceId]) => {
                const o: CompositeEC2InstanceOutputs = {
                    ipAddress: ip,
                    instanceId: instanceId,
                } 
                return o
            })
        }

        super({ 
                program: pulumiFn,
                config: {
                    "aws:region": { value: spec.awsConfig.region }
                },
                meta: new BoxMetadata({ name: name, kind: BOX_KIND_COMPOSITE_EC2_INSTANCE })
            },
        )

        this.awsClient = new AwsClient({ region: spec.awsConfig?.region })
    }

    async stackOuputToBoxOutput(o: OutputMap): Promise<CompositeEC2InstanceOutputs> {
        const values = await pulumiOutputMapToPlainObject(o)
        const result = CompositeEC2InstanceOutputsZ.safeParse(values)
        if(!result.success){
            const err = `Pulumi stack output parse error. Expected ${JSON.stringify(CompositeEC2InstanceOutputsZ.shape)}, got ${JSON.stringify(values)}}`
            console.error(err)
            throw new Error(err)
        }
    
        return result.data
    }

    async stop() {
        const o = await this.get()
        await this.awsClient.stopInstance(o.instanceId)
    }

    async start() {
        const o = await this.get()
        await this.awsClient.startInstance(o.instanceId)
    }

    async restart() {
        const o = await this.get()
        await this.awsClient.rebootInstance(o.instanceId)
    }
    
}