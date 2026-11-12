import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { DataService } from './data.service';
import { DataController, MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';

@Module({
  imports: [WorkflowModule],
  controllers: [MetadataController, DataController],
  providers: [MetadataService, DataService],
  exports: [MetadataService, DataService],
})
export class MetadataModule {}
